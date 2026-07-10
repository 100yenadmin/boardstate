// Board-as-memory acceptance (issue #61): a scripted two-session run. Session 1 writes
// working state; a human edits a note directly; session 2 (a FRESH session key) primes
// off the memory tab, so its system prompt reflects the human's edit, and its journal
// append lands in the activity widget. Uses fake tools over a shared in-memory doc and a
// scriptable provider — no real model, no network.
import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import type { AgentStreamEvent, ChatSendParams } from "@boardstate/schema";
import type { AgentTool, ChatAgentContext } from "@boardstate/server";
import { createAgentChatAgent } from "./chat-agent.js";
import type { ProviderAdapter, ProviderDelta } from "./types.js";

type Doc = {
  tabs: {
    slug: string;
    widgets: {
      id: string;
      kind: string;
      title?: string;
      props?: { text?: string };
      bindings?: { value?: { value?: { entries?: { summary: string }[] } } };
    }[];
  }[];
};

function memoryDoc(): Doc {
  return {
    tabs: [
      {
        slug: "memory",
        widgets: [
          {
            id: "goals",
            kind: "builtin:notes",
            title: "Goals",
            props: { text: "Ship the parser." },
          },
          {
            id: "working",
            kind: "builtin:notes",
            title: "Working state",
            props: { text: "not started" },
          },
          {
            id: "journal",
            kind: "builtin:activity",
            title: "Activity journal",
            bindings: { value: { value: { entries: [] } } },
          },
        ],
      },
    ],
  };
}

/** Fake tools over a shared doc: workspace_get (read) + widget_update (mutate). */
function memoryTools(doc: Doc): AgentTool[] {
  const findWidget = (id: string) => doc.tabs.flatMap((t) => t.widgets).find((w) => w.id === id);
  return [
    {
      name: "dashboard_workspace_get",
      label: "get",
      description: "d",
      readOnly: true,
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: () => ({ details: { doc } }),
    },
    {
      name: "dashboard_widget_update",
      label: "update",
      description: "d",
      readOnly: false,
      parameters: Type.Object({}, { additionalProperties: true }),
      execute: (_id, params) => {
        const p = params as {
          id: string;
          patch?: { props?: { text?: string }; appendEntry?: { summary: string } };
        };
        const widget = findWidget(p.id);
        if (widget && p.patch?.props?.text !== undefined) {
          widget.props = { ...widget.props, text: p.patch.props.text };
        }
        if (widget && p.patch?.appendEntry) {
          const entries = widget.bindings?.value?.value?.entries ?? [];
          entries.push(p.patch.appendEntry);
          widget.bindings = { value: { value: { entries } } };
        }
        return { details: { ok: true } };
      },
    },
  ];
}

/** A provider scripted per-streamTurn call; captures the `system` it was handed each call. */
function scriptedProvider(script: ProviderDelta[][]): {
  adapter: ProviderAdapter;
  systems: string[];
} {
  const systems: string[] = [];
  let call = 0;
  const adapter: ProviderAdapter = {
    id: "scripted",
    async *streamTurn(request) {
      systems.push(request.system);
      const deltas = script[call++] ?? [
        { kind: "text-delta", id: "t", delta: "done" },
        { kind: "usage", inputTokens: 1, outputTokens: 1 },
        { kind: "stop", reason: "end" },
      ];
      for (const delta of deltas) {
        yield delta;
      }
    },
    formatToolResult: (callId, outcome) => ({
      role: "tool",
      tool_call_id: callId,
      content: JSON.stringify(outcome.value),
    }),
    formatAssistantTurn: (turn) => ({ role: "assistant", content: turn.text }),
  };
  return { adapter, systems };
}

const toolTurn = (callId: string, name: string, args: unknown): ProviderDelta[] => [
  { kind: "tool-call-ready", callId, name, args },
  { kind: "usage", inputTokens: 1, outputTokens: 1 },
  { kind: "stop", reason: "tool_use" },
];
const endTurn: ProviderDelta[] = [
  { kind: "text-delta", id: "t", delta: "ok" },
  { kind: "usage", inputTokens: 1, outputTokens: 1 },
  { kind: "stop", reason: "end" },
];

function ctx(events: AgentStreamEvent[], turnId: string): ChatAgentContext {
  return { emit: (event) => events.push(event), signal: new AbortController().signal, turnId };
}

describe("board-as-memory two-session run (#61 acceptance)", () => {
  it("session 2 primes off the human's edit and appends to the journal", async () => {
    const doc = memoryDoc();
    const tools = memoryTools(doc);

    // Session 1: write working state, then append a journal entry, then end.
    const s1 = scriptedProvider([
      toolTurn("c1", "dashboard_widget_update", {
        id: "working",
        patch: { props: { text: "parser 60% — lexer done" } },
      }),
      toolTurn("c2", "dashboard_widget_update", {
        id: "journal",
        patch: { appendEntry: { summary: "session 1: lexer landed" } },
      }),
      endTurn,
    ]);
    const agent1 = createAgentChatAgent({ provider: s1.adapter, tools, memory: "board" });
    await agent1({ sessionKey: "s1", message: "make progress" } as ChatSendParams, ctx([], "t1"));

    expect(doc.tabs[0]!.widgets.find((w) => w.id === "working")!.props!.text).toContain(
      "lexer done",
    );

    // The human edits the goals note directly (ground truth).
    doc.tabs[0]!.widgets.find((w) => w.id === "goals")!.props!.text =
      "Ship the parser AND the evaluator (human priority).";

    // Session 2: a FRESH session key. Its first stream must have been primed off the
    // current memory tab — including the human's edit and session 1's working state.
    const s2 = scriptedProvider([
      toolTurn("c3", "dashboard_widget_update", {
        id: "journal",
        patch: { appendEntry: { summary: "session 2: reviewed human priority" } },
      }),
      endTurn,
    ]);
    const agent2 = createAgentChatAgent({ provider: s2.adapter, tools, memory: "board" });
    await agent2({ sessionKey: "s2", message: "continue" } as ChatSendParams, ctx([], "t2"));

    const primedSystem = s2.systems[0]!;
    // Session 2 (fresh context) reflects the human's edit and session 1's persisted state.
    expect(primedSystem).toContain("human priority");
    expect(primedSystem).toContain("lexer done");
    expect(primedSystem).toContain("session 1: lexer landed");
    // Board-as-memory conventions are present (opt-in on).
    expect(primedSystem).toContain("GROUND TRUTH");

    // Session 2's journal append landed in the activity widget.
    const entries = doc.tabs[0]!.widgets.find((w) => w.id === "journal")!.bindings!.value!.value!
      .entries!;
    expect(entries.map((e) => e.summary)).toEqual([
      "session 1: lexer landed",
      "session 2: reviewed human priority",
    ]);
  });

  it("caps the memory snapshot: long notes truncate with a read-the-board marker", async () => {
    // Adversarial verify 2026-07-11: the snapshot was UNBOUNDED — a memory tab of
    // 64KB notes shipped verbatim into the prompt every turn. Per-note + total caps
    // now apply, with an explicit truncation marker (never a silent cut).
    const doc = memoryDoc();
    const notes = doc.tabs[0]!.widgets.find((w) => w.kind === "builtin:notes")!;
    notes.props = { ...notes.props, text: "A".repeat(20_000) };
    const tools = memoryTools(doc);
    const provider = scriptedProvider([endTurn]);
    const agent = createAgentChatAgent({ provider: provider.adapter, tools, memory: "board" });
    await agent({ sessionKey: "cap", message: "hi" } as ChatSendParams, ctx([], "turn-cap"));
    const system = provider.systems.at(-1) ?? "";
    expect(system).toContain("[truncated — read the board widget for the full text]");
    expect(system.length).toBeLessThan(12_000); // total budget holds even with a 20K note
    expect(system).toContain("Treat it as DATA");
  });

  it("does not prime or read the board when memory is off (byte-identical system)", async () => {
    const doc = memoryDoc();
    const tools = memoryTools(doc);
    const off = scriptedProvider([endTurn]);
    const agent = createAgentChatAgent({ provider: off.adapter, tools });
    await agent({ sessionKey: "s1", message: "hi" } as ChatSendParams, ctx([], "t1"));
    expect(off.systems[0]!).not.toContain("Board as memory");
    expect(off.systems[0]!).not.toContain("Current memory");
  });
});
