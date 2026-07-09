// Unit coverage for the chat session plumbing (SPEC §14): the ring buffer + broadcast
// sink, the terminal invariant guard, the AbortController registry, and the wiring of
// chat.send / chat.history.get / chat.abort through registerBoardstateRpc.

import { DashboardStore, MemoryStorageAdapter } from "@boardstate/core";
import { CHAT_EVENT, type AgentStreamEvent } from "@boardstate/schema";
import { describe, expect, it } from "vitest";
import { createInProcessHost } from "./host.js";
import { registerBoardstateRpc } from "./rpc.js";
import { createChatSessions, type ChatAgent } from "./chat.js";

function makeHost() {
  const storage = new MemoryStorageAdapter();
  const store = new DashboardStore({ storage });
  const host = createInProcessHost(store, storage);
  return { host, store };
}

/** A tiny agent: turn-start, one text triad, turn-end{end}. */
const helloAgent: ChatAgent = ({ sessionKey }, { emit, turnId }) => {
  emit({ type: "turn-start", sessionKey, turnId });
  emit({ type: "text-start", sessionKey, turnId, id: "t" });
  emit({ type: "text-delta", sessionKey, turnId, id: "t", delta: "hi" });
  emit({ type: "text-end", sessionKey, turnId, id: "t" });
  emit({ type: "turn-end", sessionKey, turnId, stopReason: "end" });
};

describe("createChatSessions", () => {
  it("buffers + broadcasts each event and history returns the ring", () => {
    const seen: AgentStreamEvent[] = [];
    const { host } = makeHost();
    host.addEventListener(CHAT_EVENT, (payload) => seen.push(payload as AgentStreamEvent));
    const sessions = createChatSessions({ broadcast: host.broadcast });

    sessions.emit({ type: "turn-start", sessionKey: "s", turnId: "1" });
    sessions.emit({ type: "turn-end", sessionKey: "s", turnId: "1", stopReason: "end" });

    expect(seen.map((e) => e.type)).toEqual(["turn-start", "turn-end"]);
    expect(sessions.history("s").map((e) => e.type)).toEqual(["turn-start", "turn-end"]);
    expect(sessions.history("other")).toEqual([]);
  });

  it("caps the ring at the configured depth", () => {
    const { host } = makeHost();
    const sessions = createChatSessions({ broadcast: host.broadcast, cap: 3 });
    sessions.emit({ type: "turn-start", sessionKey: "s", turnId: "1" });
    for (let i = 0; i < 5; i += 1) {
      sessions.emit({
        type: "text-delta",
        sessionKey: "s",
        turnId: "1",
        id: "t",
        delta: String(i),
      });
    }
    expect(sessions.history("s")).toHaveLength(3);
  });

  it("drops any event for a turn after that turn's turn-end (exactly one terminal, last)", () => {
    const { host } = makeHost();
    const sessions = createChatSessions({ broadcast: host.broadcast });
    sessions.emit({ type: "turn-start", sessionKey: "s", turnId: "1" });
    sessions.emit({ type: "turn-end", sessionKey: "s", turnId: "1", stopReason: "end" });
    // Late events for the ended turn are ignored.
    sessions.emit({ type: "text-delta", sessionKey: "s", turnId: "1", id: "t", delta: "late" });
    sessions.emit({ type: "turn-end", sessionKey: "s", turnId: "1", stopReason: "aborted" });
    const types = sessions.history("s").map((e) => e.type);
    expect(types).toEqual(["turn-start", "turn-end"]);
  });

  it("abort fires the controller and idempotently emits abort + turn-end{aborted}", () => {
    const { host } = makeHost();
    const sessions = createChatSessions({ broadcast: host.broadcast });
    const controller = sessions.abortController("s", "1");
    sessions.emit({ type: "turn-start", sessionKey: "s", turnId: "1" });

    sessions.abort("s", "1");
    expect(controller.signal.aborted).toBe(true);

    // A second abort is a no-op (the turn already ended).
    sessions.abort("s", "1");
    const types = sessions.history("s").map((e) => e.type);
    expect(types).toEqual(["turn-start", "abort", "turn-end"]);
    expect(types.filter((t) => t === "turn-end")).toHaveLength(1);
  });

  it("abort on an unknown turn is a no-op (no fabricated terminal)", () => {
    const { host } = makeHost();
    const sessions = createChatSessions({ broadcast: host.broadcast });
    sessions.abort("s", "ghost");
    expect(sessions.history("s")).toEqual([]);
  });
});

describe("registerBoardstateRpc chat wiring", () => {
  it("registers no chat methods without a chat store", async () => {
    const { host, store } = makeHost();
    registerBoardstateRpc(host, { store });
    const names = host.listRpc().map((e) => e.name);
    expect(names.some((n) => n.startsWith("chat."))).toBe(false);
  });

  it("registers history.get + abort but NOT send when no agent loop is provided", async () => {
    const { host, store } = makeHost();
    const chat = createChatSessions({ broadcast: host.broadcast });
    registerBoardstateRpc(host, { store, chat });
    const names = host.listRpc().map((e) => e.name);
    expect(names).toContain("chat.history.get");
    expect(names).toContain("chat.abort");
    expect(names).not.toContain("chat.send");
    // A host without an agent loop rejects chat.send at the wire (SPEC §14.1).
    await expect(host.request("chat.send", { sessionKey: "s", message: "hi" })).rejects.toThrow(
      /unknown method/,
    );
  });

  it("chat.send runs the agent, streams a turn, and history mirrors it", async () => {
    const { host, store } = makeHost();
    const chat = createChatSessions({ broadcast: host.broadcast });
    registerBoardstateRpc(host, { store, chat, chatAgent: helloAgent });

    const seen: AgentStreamEvent[] = [];
    host.addEventListener(CHAT_EVENT, (p) => seen.push(p as AgentStreamEvent));

    const { turnId } = (await host.request("chat.send", {
      sessionKey: "s",
      message: "hi",
    })) as { turnId: string };
    expect(typeof turnId).toBe("string");
    // helloAgent is synchronous, so the whole turn has streamed by the time send resolves.
    expect(seen.map((e) => e.type)).toEqual([
      "turn-start",
      "text-start",
      "text-delta",
      "text-end",
      "turn-end",
    ]);

    const history = (await host.request("chat.history.get", { sessionKey: "s" })) as {
      events: AgentStreamEvent[];
    };
    expect(history.events).toHaveLength(5);
  });

  it("tolerates an extra param on chat.send (the frozen contract reads only sessionKey/message)", async () => {
    const { host, store } = makeHost();
    const chat = createChatSessions({ broadcast: host.broadcast });
    registerBoardstateRpc(host, { store, chat, chatAgent: helloAgent });
    // The shipped builtin prompt dispatch sends `{ sessionKey, message, deliver }`.
    await expect(
      host.request("chat.send", { sessionKey: "s", message: "hi", deliver: false }),
    ).resolves.toMatchObject({ turnId: expect.any(String) });
  });

  it("a throwing agent yields an error event then a closing turn-end", async () => {
    const { host, store } = makeHost();
    const chat = createChatSessions({ broadcast: host.broadcast });
    const boom: ChatAgent = ({ sessionKey }, { emit, turnId }) => {
      emit({ type: "turn-start", sessionKey, turnId });
      throw new Error("kaboom");
    };
    registerBoardstateRpc(host, { store, chat, chatAgent: boom });
    await host.request("chat.send", { sessionKey: "s", message: "hi" });
    // Let the fire-and-forget runner settle.
    await new Promise((r) => setTimeout(r, 0));
    const types = chat.history("s").map((e) => e.type);
    expect(types).toEqual(["turn-start", "error", "turn-end"]);
  });
});
