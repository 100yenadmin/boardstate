// Unit tests for the builtin:chat render model. The reducer is the heart of the
// widget — the triad assembly (start → delta* → end), consecutive-tool grouping,
// abort handling, retry classification, and the out-of-order/duplicate guards all
// live here, so this is where they're pinned. The reducer must be TOTAL: no event
// order may throw.

import { describe, expect, it } from "vitest";
import type { AgentStreamEvent, ChatStopReason } from "@boardstate/schema";
import {
  chatToolMark,
  reduceChatEvents,
  type ChatTextItem,
  type ChatToolGroupItem,
} from "./chat-model.js";

const S = "main";
const T = "t1";

// Terse event builders keyed to the frozen §14 shapes.
const ev = {
  turnStart: (turnId = T): AgentStreamEvent => ({ type: "turn-start", sessionKey: S, turnId }),
  textStart: (id: string, turnId = T): AgentStreamEvent => ({
    type: "text-start",
    sessionKey: S,
    turnId,
    id,
  }),
  textDelta: (id: string, delta: string, turnId = T): AgentStreamEvent => ({
    type: "text-delta",
    sessionKey: S,
    turnId,
    id,
    delta,
  }),
  textEnd: (id: string, turnId = T): AgentStreamEvent => ({
    type: "text-end",
    sessionKey: S,
    turnId,
    id,
  }),
  toolStart: (callId: string, name: string, turnId = T): AgentStreamEvent => ({
    type: "tool-call-start",
    sessionKey: S,
    turnId,
    callId,
    name,
  }),
  toolDelta: (callId: string, argsTextDelta: string, turnId = T): AgentStreamEvent => ({
    type: "tool-call-delta",
    sessionKey: S,
    turnId,
    callId,
    argsTextDelta,
  }),
  toolReady: (callId: string, name: string, args: unknown, turnId = T): AgentStreamEvent => ({
    type: "tool-call-ready",
    sessionKey: S,
    turnId,
    callId,
    name,
    args,
  }),
  toolResult: (
    callId: string,
    ok: boolean,
    extra: { result?: unknown; error?: { code: string; message: string; retryable: boolean } } = {},
    turnId = T,
  ): AgentStreamEvent => ({ type: "tool-result", sessionKey: S, turnId, callId, ok, ...extra }),
  usage: (inputTokens: number, outputTokens: number, turnId = T): AgentStreamEvent => ({
    type: "usage",
    sessionKey: S,
    turnId,
    inputTokens,
    outputTokens,
  }),
  turnEnd: (stopReason: ChatStopReason, turnId = T): AgentStreamEvent => ({
    type: "turn-end",
    sessionKey: S,
    turnId,
    stopReason,
  }),
  abort: (turnId = T): AgentStreamEvent => ({ type: "abort", sessionKey: S, turnId }),
  error: (
    code: string,
    message: string,
    retryable: boolean,
    turnId: string | undefined = T,
  ): AgentStreamEvent => ({ type: "error", sessionKey: S, turnId, code, message, retryable }),
};

describe("reduceChatEvents — triad assembly", () => {
  it("assembles a start → delta* → end text triad into one closed block", () => {
    const turns = reduceChatEvents([
      ev.turnStart(),
      ev.textStart("a"),
      ev.textDelta("a", "Hel"),
      ev.textDelta("a", "lo"),
      ev.textEnd("a"),
      ev.turnEnd("end"),
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.status).toBe("complete");
    expect(turns[0]!.stopReason).toBe("end");
    const text = turns[0]!.items[0] as ChatTextItem;
    expect(text).toMatchObject({ kind: "text", text: "Hello", closed: true });
  });

  it("keeps concurrent text blocks separate by id (triads never collide)", () => {
    const turns = reduceChatEvents([
      ev.turnStart(),
      ev.textStart("a"),
      ev.textStart("b"),
      ev.textDelta("a", "A"),
      ev.textDelta("b", "B"),
      ev.textEnd("a"),
    ]);
    const items = turns[0]!.items.filter((i) => i.kind === "text") as ChatTextItem[];
    expect(items.map((i) => i.text)).toEqual(["A", "B"]);
    expect(items[0]!.closed).toBe(true);
    expect(items[1]!.closed).toBe(false);
  });
});

describe("reduceChatEvents — tool grouping", () => {
  it("merges consecutive tool calls into ONE group with per-call marks", () => {
    const turns = reduceChatEvents([
      ev.turnStart(),
      ev.toolStart("A", "dashboard.workspace.get"),
      ev.toolReady("A", "dashboard.workspace.get", {}),
      ev.toolResult("A", true),
      ev.toolStart("B", "dashboard.tab.create"),
      ev.toolResult("B", true),
      ev.toolStart("C", "dashboard.widget.add"),
      ev.toolResult("C", false, { error: { code: "x", message: "no", retryable: false } }),
    ]);
    const groups = turns[0]!.items.filter((i) => i.kind === "tools") as ChatToolGroupItem[];
    expect(groups).toHaveLength(1);
    expect(groups[0]!.calls).toHaveLength(3);
    expect(groups[0]!.calls.map(chatToolMark)).toEqual(["ok", "ok", "error"]);
  });

  it("breaks the group when a text block intervenes", () => {
    const turns = reduceChatEvents([
      ev.turnStart(),
      ev.toolStart("A", "m"),
      ev.toolResult("A", true),
      ev.textStart("t"),
      ev.textDelta("t", "hi"),
      ev.toolStart("B", "m"),
      ev.toolResult("B", true),
    ]);
    const kinds = turns[0]!.items.map((i) => i.kind);
    expect(kinds).toEqual(["tools", "text", "tools"]);
  });

  it("accumulates raw arg-text deltas and parsed args", () => {
    const turns = reduceChatEvents([
      ev.turnStart(),
      ev.toolStart("A", "m"),
      ev.toolDelta("A", '{"x":'),
      ev.toolDelta("A", "1}"),
      ev.toolReady("A", "m", { x: 1 }),
    ]);
    const call = (turns[0]!.items[0] as ChatToolGroupItem).calls[0]!;
    expect(call.argsText).toBe('{"x":1}');
    expect(call.args).toEqual({ x: 1 });
    expect(call.status).toBe("ready");
  });
});

describe("reduceChatEvents — abort", () => {
  it("marks the turn aborted mid-text and leaves the open block unclosed", () => {
    const turns = reduceChatEvents([
      ev.turnStart(),
      ev.textStart("a"),
      ev.textDelta("a", "partial"),
      ev.abort(),
      ev.turnEnd("aborted"),
    ]);
    expect(turns[0]!.status).toBe("aborted");
    const text = turns[0]!.items[0] as ChatTextItem;
    expect(text.text).toBe("partial");
    expect(text.closed).toBe(false);
  });
});

describe("reduceChatEvents — out-of-order & duplicate guards", () => {
  it("opens a text block from a delta that precedes its start", () => {
    const turns = reduceChatEvents([ev.textDelta("a", "x", "z1"), ev.textStart("a", "z1")]);
    const text = turns[0]!.items[0] as ChatTextItem;
    expect(text.text).toBe("x");
  });

  it("ignores a tool-result for an unknown callId without throwing", () => {
    expect(() => reduceChatEvents([ev.turnStart(), ev.toolResult("ghost", true)])).not.toThrow();
    const turns = reduceChatEvents([ev.turnStart(), ev.toolResult("ghost", true)]);
    expect(turns[0]!.items).toHaveLength(0);
  });

  it("materializes a call from a ready that precedes its start", () => {
    const turns = reduceChatEvents([ev.turnStart(), ev.toolReady("A", "m", { a: 1 })]);
    const call = (turns[0]!.items[0] as ChatToolGroupItem).calls[0]!;
    expect(call).toMatchObject({ callId: "A", status: "ready", args: { a: 1 } });
  });

  it("keeps the first turn-end and ignores duplicates", () => {
    const turns = reduceChatEvents([ev.turnStart(), ev.turnEnd("end"), ev.turnEnd("refusal")]);
    expect(turns[0]!.stopReason).toBe("end");
    expect(turns[0]!.status).toBe("complete");
  });

  it("lazily creates a turn for events that precede turn-start", () => {
    const turns = reduceChatEvents([ev.textStart("a"), ev.textDelta("a", "hi")]);
    expect(turns).toHaveLength(1);
    expect((turns[0]!.items[0] as ChatTextItem).text).toBe("hi");
  });
});

describe("reduceChatEvents — error retry classification", () => {
  it("marks a retryable error superseded once the turn continues", () => {
    const turns = reduceChatEvents([
      ev.turnStart(),
      ev.error("rate", "429", true),
      ev.textStart("a"),
      ev.textDelta("a", "ok now"),
    ]);
    const errItem = turns[0]!.items.find((i) => i.kind === "error");
    expect(errItem).toMatchObject({ retryable: true, superseded: true });
  });

  it("leaves a retryable error final when only turn-end follows", () => {
    const turns = reduceChatEvents([
      ev.turnStart(),
      ev.error("rate", "429", true),
      ev.turnEnd("end"),
    ]);
    const errItem = turns[0]!.items.find((i) => i.kind === "error");
    expect(errItem).toMatchObject({ retryable: true, superseded: false });
  });

  it("never supersedes a non-retryable error", () => {
    const turns = reduceChatEvents([
      ev.turnStart(),
      ev.error("bad", "nope", false),
      ev.textStart("a"),
      ev.textDelta("a", "more"),
    ]);
    const errItem = turns[0]!.items.find((i) => i.kind === "error");
    expect(errItem).toMatchObject({ retryable: false, superseded: false });
  });

  it("attaches a turnless error to the most recent turn", () => {
    const turns = reduceChatEvents([ev.turnStart(), ev.error("io", "boom", false, undefined)]);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.items.some((i) => i.kind === "error")).toBe(true);
  });
});

describe("reduceChatEvents — turns & usage", () => {
  it("keeps turns in first-seen order and records the latest cumulative usage", () => {
    const turns = reduceChatEvents([
      ev.turnStart("a"),
      ev.usage(1, 1, "a"),
      ev.usage(10, 20, "a"),
      ev.turnEnd("end", "a"),
      ev.turnStart("b"),
      ev.turnEnd("length", "b"),
    ]);
    expect(turns.map((t) => t.turnId)).toEqual(["a", "b"]);
    expect(turns[0]!.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    expect(turns[1]!.stopReason).toBe("length");
  });

  it("treats a turn with no turn-end as still streaming (a live turn)", () => {
    const turns = reduceChatEvents([ev.turnStart(), ev.textStart("a"), ev.textDelta("a", "…")]);
    expect(turns[0]!.status).toBe("streaming");
  });
});
