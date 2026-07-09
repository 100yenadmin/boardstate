import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import type { AgentStreamEvent } from "@boardstate/schema";
import { toolJson, type AgentTool } from "@boardstate/server";
import { runAgentTurn } from "./runner.js";
import type { ProviderAdapter, ProviderDelta } from "./types.js";

const EMPTY = Type.Object({}, { additionalProperties: false });
const sleepNoop = (): Promise<void> => Promise.resolve();

/** A provider stub whose Nth `streamTurn` yields `script(n)`. */
function scriptedAdapter(script: (call: number) => ProviderDelta[]): {
  adapter: ProviderAdapter;
  callCount: () => number;
} {
  let call = 0;
  const adapter: ProviderAdapter = {
    id: "stub",
    async *streamTurn() {
      const deltas = script(call);
      call += 1;
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
  return { adapter, callCount: () => call };
}

function tool(name: string, readOnly: boolean, execute: AgentTool["execute"]): AgentTool {
  return { name, label: name, description: "d", readOnly, parameters: EMPTY, execute };
}

function run(
  adapter: ProviderAdapter,
  tools: AgentTool[],
  overrides: Partial<Parameters<typeof runAgentTurn>[0]> = {},
) {
  const events: AgentStreamEvent[] = [];
  const controller = new AbortController();
  const promise = runAgentTurn({
    tools,
    provider: adapter,
    system: "sys",
    userMessage: "go",
    emit: (event) => events.push(event),
    signal: controller.signal,
    sessionKey: "s1",
    turnId: "t1",
    tokenCeiling: 1000,
    sleep: sleepNoop,
    ...overrides,
  });
  return { events, controller, promise };
}

const types = (events: AgentStreamEvent[]): string[] => events.map((e) => e.type);

describe("runAgentTurn — §14 invariants", () => {
  it("streams a text-only turn: turn-start first, cumulative usage, turn-end end last", async () => {
    const { adapter } = scriptedAdapter(() => [
      { kind: "text-start", id: "x" },
      { kind: "text-delta", id: "x", delta: "hi" },
      { kind: "text-end", id: "x" },
      { kind: "usage", inputTokens: 5, outputTokens: 7 },
      { kind: "stop", reason: "end" },
    ]);
    const { events, promise } = run(adapter, []);
    const result = await promise;

    expect(types(events)).toEqual([
      "turn-start",
      "text-start",
      "text-delta",
      "text-end",
      "usage",
      "turn-end",
    ]);
    expect(events.at(-1)).toMatchObject({ type: "turn-end", stopReason: "end" });
    expect(events.filter((e) => e.type === "turn-end")).toHaveLength(1);
    expect(result.stopReason).toBe("end");
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 7 });
  });

  it("executes tool calls then streams a final answer, accumulating usage across rounds", async () => {
    const executed: string[] = [];
    const readTool = tool("read_it", true, (_id) => {
      executed.push("read_it");
      return toolJson({ ok: true });
    });
    const writeTool = tool("write_it", false, (_id) => {
      executed.push("write_it");
      return toolJson({ created: true });
    });
    const { adapter } = scriptedAdapter((call) =>
      call === 0
        ? [
            { kind: "tool-call-start", callId: "c1", name: "read_it" },
            { kind: "tool-call-ready", callId: "c1", name: "read_it", args: {} },
            { kind: "tool-call-start", callId: "c2", name: "write_it" },
            { kind: "tool-call-ready", callId: "c2", name: "write_it", args: {} },
            { kind: "usage", inputTokens: 10, outputTokens: 10 },
            { kind: "stop", reason: "tool_use" },
          ]
        : [
            { kind: "text-delta", id: "y", delta: "done" },
            { kind: "usage", inputTokens: 2, outputTokens: 2 },
            { kind: "stop", reason: "end" },
          ],
    );
    const { events, promise } = run(adapter, [readTool, writeTool]);
    const result = await promise;

    expect(executed.sort()).toEqual(["read_it", "write_it"]);
    const results = events.filter((e) => e.type === "tool-result");
    expect(results).toHaveLength(2);
    expect(results.every((e) => e.type === "tool-result" && e.ok)).toBe(true);
    expect(result.stopReason).toBe("end");
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 12 });
    // Every tool-call-ready precedes its tool-result.
    for (const done of results) {
      if (done.type !== "tool-result") continue;
      const readyIdx = events.findIndex(
        (e) => e.type === "tool-call-ready" && e.callId === done.callId,
      );
      const resultIdx = events.indexOf(done);
      expect(readyIdx).toBeGreaterThanOrEqual(0);
      expect(readyIdx).toBeLessThan(resultIdx);
    }
  });

  it("runs read-only tools in parallel and mutating tools serially in order", async () => {
    const log: string[] = [];
    const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    const mkRead = (name: string): AgentTool =>
      tool(name, true, async () => {
        log.push(`${name}:start`);
        await delay(30);
        log.push(`${name}:end`);
        return toolJson({});
      });
    const mkWrite = (name: string): AgentTool =>
      tool(name, false, async () => {
        log.push(`${name}:start`);
        await delay(10);
        log.push(`${name}:end`);
        return toolJson({});
      });
    const tools = [mkRead("r1"), mkRead("r2"), mkWrite("w1"), mkWrite("w2")];
    const { adapter } = scriptedAdapter((call) =>
      call === 0
        ? [
            { kind: "tool-call-ready", callId: "r1", name: "r1", args: {} },
            { kind: "tool-call-ready", callId: "r2", name: "r2", args: {} },
            { kind: "tool-call-ready", callId: "w1", name: "w1", args: {} },
            { kind: "tool-call-ready", callId: "w2", name: "w2", args: {} },
            { kind: "usage", inputTokens: 1, outputTokens: 1 },
            { kind: "stop", reason: "tool_use" },
          ]
        : [
            { kind: "usage", inputTokens: 0, outputTokens: 0 },
            { kind: "stop", reason: "end" },
          ],
    );
    await run(adapter, tools).promise;

    // Reads overlap: r2 started before r1 finished.
    expect(log.indexOf("r2:start")).toBeLessThan(log.indexOf("r1:end"));
    // Writes are serial and in order: w2 starts only after w1 ends.
    expect(log.indexOf("w1:end")).toBeLessThan(log.indexOf("w2:start"));
  });

  it("stops with max-iterations when the model never stops asking for tools", async () => {
    let writes = 0;
    const writeTool = tool("w", false, () => {
      writes += 1;
      return toolJson({});
    });
    const { adapter } = scriptedAdapter(() => [
      { kind: "tool-call-ready", callId: "c", name: "w", args: {} },
      { kind: "usage", inputTokens: 1, outputTokens: 1 },
      { kind: "stop", reason: "tool_use" },
    ]);
    const { events, promise } = run(adapter, [writeTool], { maxToolIterations: 2 });
    const result = await promise;

    expect(result.stopReason).toBe("max-iterations");
    expect(events.at(-1)).toMatchObject({ type: "turn-end", stopReason: "max-iterations" });
    expect(writes).toBe(2);
  });

  it("stops with length when cumulative usage exceeds the token ceiling", async () => {
    let rounds = 0;
    const writeTool = tool("w", false, () => {
      rounds += 1;
      return toolJson({});
    });
    const { adapter } = scriptedAdapter(() => [
      { kind: "tool-call-ready", callId: "c", name: "w", args: {} },
      { kind: "usage", inputTokens: 60, outputTokens: 60 },
      { kind: "stop", reason: "tool_use" },
    ]);
    const { events, promise } = run(adapter, [writeTool], { tokenCeiling: 100 });
    const result = await promise;

    expect(result.stopReason).toBe("length");
    expect(events.at(-1)).toMatchObject({ type: "turn-end", stopReason: "length" });
    expect(rounds).toBe(1);
  });

  it("maps provider length/refusal stop reasons to the turn-end", async () => {
    const { adapter } = scriptedAdapter(() => [
      { kind: "usage", inputTokens: 1, outputTokens: 1 },
      { kind: "stop", reason: "refusal" },
    ]);
    const result = await run(adapter, []).promise;
    expect(result.stopReason).toBe("refusal");
  });
});

describe("runAgentTurn — abort safety", () => {
  it("never starts a later mutating call once aborted, and ends aborted", async () => {
    let w1done = false;
    let w2started = false;
    const { adapter, controller } = mkAbortDuringWrite();
    const w1 = tool("w1", false, async () => {
      controller.abort();
      await Promise.resolve();
      w1done = true;
      return toolJson({});
    });
    const w2 = tool("w2", false, () => {
      w2started = true;
      return toolJson({});
    });
    const events: AgentStreamEvent[] = [];
    const result = await runAgentTurn({
      tools: [w1, w2],
      provider: adapter,
      system: "s",
      userMessage: "go",
      emit: (e) => events.push(e),
      signal: controller.signal,
      sessionKey: "s1",
      turnId: "t1",
      tokenCeiling: 1000,
      sleep: sleepNoop,
    });

    expect(w1done).toBe(true); // in-flight write completed
    expect(w2started).toBe(false); // later write never started (no orphaned write)
    expect(result.stopReason).toBe("aborted");
    expect(types(events)).toContain("abort");
    expect(events.at(-1)).toMatchObject({ type: "turn-end", stopReason: "aborted" });
  });
});

// A stub whose one turn requests two serial writes; the first write aborts the signal.
function mkAbortDuringWrite(): { adapter: ProviderAdapter; controller: AbortController } {
  const controller = new AbortController();
  const adapter: ProviderAdapter = {
    id: "stub",
    async *streamTurn() {
      yield { kind: "tool-call-ready", callId: "w1", name: "w1", args: {} };
      yield { kind: "tool-call-ready", callId: "w2", name: "w2", args: {} };
      yield { kind: "usage", inputTokens: 1, outputTokens: 1 };
      yield { kind: "stop", reason: "tool_use" };
    },
    formatToolResult: (callId, outcome) => ({
      role: "tool",
      tool_call_id: callId,
      content: JSON.stringify(outcome.value),
    }),
    formatAssistantTurn: (turn) => ({ role: "assistant", content: turn.text }),
  };
  return { adapter, controller };
}

describe("runAgentTurn — provider errors & retries", () => {
  it("retries retryable failures with backoff, then succeeds", async () => {
    const { adapter, callCount } = scriptedAdapter((call) =>
      call < 2
        ? [{ kind: "error", code: "http_503", message: "unavailable", retryable: true }]
        : [
            { kind: "text-delta", id: "z", delta: "recovered" },
            { kind: "usage", inputTokens: 1, outputTokens: 1 },
            { kind: "stop", reason: "end" },
          ],
    );
    const { events, promise } = run(adapter, []);
    const result = await promise;

    expect(callCount()).toBe(3);
    expect(events.filter((e) => e.type === "error")).toHaveLength(2);
    expect(events.some((e) => e.type === "text-delta")).toBe(true);
    expect(result.stopReason).toBe("end");
  });

  it("does not retry a non-retryable failure", async () => {
    const { adapter, callCount } = scriptedAdapter(() => [
      { kind: "error", code: "http_400", message: "bad", retryable: false },
    ]);
    const { events, promise } = run(adapter, []);
    const result = await promise;

    expect(callCount()).toBe(1);
    expect(events.filter((e) => e.type === "error")).toHaveLength(1);
    expect(result.stopReason).toBe("end");
    expect(events.at(-1)).toMatchObject({ type: "turn-end", stopReason: "end" });
  });

  it("gives up after the retry budget is exhausted and ends the turn", async () => {
    const { adapter, callCount } = scriptedAdapter(() => [
      { kind: "error", code: "http_429", message: "slow down", retryable: true },
    ]);
    const { events, promise } = run(adapter, [], {
      retry: { maxAttempts: 4, baseMs: 1, maxMs: 5 },
    });
    const result = await promise;

    expect(callCount()).toBe(4);
    expect(events.filter((e) => e.type === "error")).toHaveLength(4);
    expect(result.stopReason).toBe("end");
  });

  it("surfaces a tool execution failure as a failed tool-result but keeps the loop valid", async () => {
    const boom = tool("boom", false, () => {
      throw new Error("kaboom");
    });
    const { adapter } = scriptedAdapter((call) =>
      call === 0
        ? [
            { kind: "tool-call-ready", callId: "c", name: "boom", args: {} },
            { kind: "usage", inputTokens: 1, outputTokens: 1 },
            { kind: "stop", reason: "tool_use" },
          ]
        : [
            { kind: "usage", inputTokens: 0, outputTokens: 0 },
            { kind: "stop", reason: "end" },
          ],
    );
    const { events, promise } = run(adapter, [boom]);
    const result = await promise;

    const toolResult = events.find((e) => e.type === "tool-result");
    expect(toolResult).toMatchObject({
      ok: false,
      error: { code: "tool_error", message: "kaboom" },
    });
    expect(result.stopReason).toBe("end");
  });

  it("reports an unknown tool as a failed tool-result", async () => {
    const { adapter } = scriptedAdapter((call) =>
      call === 0
        ? [
            { kind: "tool-call-ready", callId: "c", name: "nope", args: {} },
            { kind: "usage", inputTokens: 1, outputTokens: 1 },
            { kind: "stop", reason: "tool_use" },
          ]
        : [
            { kind: "usage", inputTokens: 0, outputTokens: 0 },
            { kind: "stop", reason: "end" },
          ],
    );
    const { events, promise } = run(adapter, []);
    await promise;
    expect(events.find((e) => e.type === "tool-result")).toMatchObject({
      ok: false,
      error: { code: "unknown_tool" },
    });
  });
});
