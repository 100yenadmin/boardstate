import { describe, expect, it } from "vitest";
import type { AgentStreamEvent, ChatSendParams } from "@boardstate/schema";
import type { ChatAgentContext } from "@boardstate/server";
import { createAgentChatAgent, truncateHistory } from "./chat-agent.js";
import { compositionGuideTool } from "./system-prompt.js";
import type { ProviderAdapter, ProviderDelta, ProviderMessage } from "./types.js";

/** A provider that records the messages it was handed and replies with fixed text. */
function capturingProvider(reply: string): {
  adapter: ProviderAdapter;
  seen: ProviderMessage[][];
} {
  const seen: ProviderMessage[][] = [];
  const adapter: ProviderAdapter = {
    id: "cap",
    async *streamTurn(request) {
      // Snapshot: the runner keeps mutating this array after streaming.
      seen.push(request.messages.map((message) => ({ ...message })));
      const deltas: ProviderDelta[] = [
        { kind: "text-delta", id: "a", delta: reply },
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
  return { adapter, seen };
}

function ctx(events: AgentStreamEvent[], turnId: string): ChatAgentContext {
  return { emit: (event) => events.push(event), signal: new AbortController().signal, turnId };
}

describe("createAgentChatAgent", () => {
  it("throws without host or tools", () => {
    expect(() => createAgentChatAgent({ provider: capturingProvider("x").adapter })).toThrow();
  });

  it("runs a turn through the provider and emits the event stream", async () => {
    const { adapter } = capturingProvider("hello");
    const chatAgent = createAgentChatAgent({ provider: adapter, tools: [compositionGuideTool] });
    const events: AgentStreamEvent[] = [];
    const params: ChatSendParams = { sessionKey: "s1", message: "hi" };
    await chatAgent(params, ctx(events, "t1"));

    expect(events[0]).toMatchObject({ type: "turn-start" });
    expect(events.at(-1)).toMatchObject({ type: "turn-end", stopReason: "end" });
    expect(events.some((e) => e.type === "text-delta")).toBe(true);
  });

  it("threads per-session history into the next turn", async () => {
    const { adapter, seen } = capturingProvider("reply");
    const chatAgent = createAgentChatAgent({ provider: adapter, tools: [] });

    await chatAgent({ sessionKey: "s1", message: "first" }, ctx([], "t1"));
    await chatAgent({ sessionKey: "s1", message: "second" }, ctx([], "t2"));

    // Turn 2 sees turn 1's user + assistant messages, then the new user message.
    expect(seen[1]).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "second" },
    ]);
    // A different session starts fresh.
    await chatAgent({ sessionKey: "s2", message: "other" }, ctx([], "t3"));
    expect(seen[2]).toEqual([{ role: "user", content: "other" }]);
  });

  it("does not persist history from an aborted turn", async () => {
    const controller = new AbortController();
    const adapter: ProviderAdapter = {
      id: "abrt",
      async *streamTurn() {
        controller.abort();
        yield { kind: "stop", reason: "end" };
      },
      formatToolResult: (callId) => ({ role: "tool", tool_call_id: callId, content: "" }),
      formatAssistantTurn: (turn) => ({ role: "assistant", content: turn.text }),
    };
    const seen: ProviderMessage[][] = [];
    const capturing: ProviderAdapter = {
      ...adapter,
      async *streamTurn(request) {
        seen.push(request.messages.map((message) => ({ ...message })));
        yield* adapter.streamTurn(request);
      },
    };
    const chatAgent = createAgentChatAgent({ provider: capturing, tools: [] });
    await chatAgent(
      { sessionKey: "s1", message: "aborted turn" },
      { emit: () => {}, signal: controller.signal, turnId: "t1" },
    );
    // Next turn's history is empty — the aborted turn was not stored.
    await chatAgent(
      { sessionKey: "s1", message: "again" },
      { emit: () => {}, signal: new AbortController().signal, turnId: "t2" },
    );
    expect(seen[1]).toEqual([{ role: "user", content: "again" }]);
  });
});

describe("truncateHistory", () => {
  it("elides oldest tool-result contents while keeping dialogue", () => {
    const bigPayload = "x".repeat(4000);
    const messages: ProviderMessage[] = [
      { role: "user", content: "question" },
      { role: "assistant", content: "answer" },
      { role: "tool", tool_call_id: "c1", content: bigPayload },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "c2", content: bigPayload, is_error: false }],
      },
    ];
    const truncated = truncateHistory(messages, 1000);

    expect(truncated[0]).toEqual({ role: "user", content: "question" });
    expect(truncated[1]).toEqual({ role: "assistant", content: "answer" });
    expect(truncated[2]).toEqual({ role: "tool", tool_call_id: "c1", content: "[elided]" });
    expect(truncated[3]).toMatchObject({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "c2", content: "[elided]" }],
    });
    // Input array is not mutated.
    expect(messages[2]).toEqual({ role: "tool", tool_call_id: "c1", content: bigPayload });
  });

  it("leaves a small history untouched", () => {
    const messages: ProviderMessage[] = [
      { role: "user", content: "hi" },
      { role: "tool", tool_call_id: "c", content: "small" },
    ];
    expect(truncateHistory(messages, 100_000)).toEqual(messages);
  });
});
