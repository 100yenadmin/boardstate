// `runAgentTurn` — the provider loop (SPEC §14.4, ROADMAP M2). One turn = stream a
// provider response (forwarding every `ProviderDelta` 1:1 as an `AgentStreamEvent`
// stamped with sessionKey/turnId), and while the model asks for tools: execute them
// (read-only tools in parallel, mutating tools serially in order), append the
// provider-formatted results, and stream again — until the model stops, a ceiling is
// hit, the turn aborts, or the provider fails past its retry budget.

import type { AgentStreamEvent, ChatStopReason } from "@boardstate/schema";
import { agentToolToJsonSchema, type AgentTool } from "@boardstate/server";
import { backoffMs, DEFAULT_RETRY_POLICY, classifyFetchError, type RetryPolicy } from "./errors.js";
import type {
  AssistantTurn,
  ProviderAdapter,
  ProviderMessage,
  ProviderTool,
  ToolOutcome,
} from "./types.js";

const DEFAULT_MAX_TOOL_ITERATIONS = 20;

export type RunAgentTurnOptions = {
  /** The agent tool set (with `.execute` and `.readOnly`); schemas derived for the provider. */
  tools: AgentTool[];
  provider: ProviderAdapter;
  system: string;
  /** Prior provider-native messages for this session (default: none). */
  history?: ProviderMessage[];
  userMessage: string;
  /** Sink for the turn's `AgentStreamEvent`s (the chat session's `emit`). */
  emit: (event: AgentStreamEvent) => void;
  signal: AbortSignal;
  sessionKey: string;
  turnId: string;
  /** REQUIRED per-turn cost guard: when cumulative tokens exceed this, the turn ends `length`. */
  tokenCeiling: number;
  /** Tool-execution rounds before ending `max-iterations` (default 20). */
  maxToolIterations?: number;
  /** Provider retry policy (default: 4 attempts, 500ms→30s expo backoff + jitter). */
  retry?: RetryPolicy;
  /** Injectable delay for retry backoff (default real `setTimeout`; tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
};

export type RunAgentTurnResult = {
  stopReason: ChatStopReason;
  /** The full provider-native message list after the turn (for history persistence). */
  messages: ProviderMessage[];
  usage: { inputTokens: number; outputTokens: number };
};

type ReadyCall = { callId: string; name: string; args: unknown };

type StreamOutcome =
  | {
      kind: "ok";
      text: string;
      toolCalls: ReadyCall[];
      stop: "tool_use" | "end" | "length" | "refusal";
      usage: { inputTokens: number; outputTokens: number };
    }
  // A terminal provider failure: the `error` event(s) were already emitted; end the turn.
  | { kind: "error" }
  // The signal aborted mid-stream: the caller runs abort handling (no error event).
  | { kind: "aborted" };

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Stream ONE provider turn, forwarding deltas and applying the retry policy on failure. */
async function streamOneProviderTurn(args: {
  provider: ProviderAdapter;
  system: string;
  messages: ProviderMessage[];
  providerTools: ProviderTool[];
  emit: (event: AgentStreamEvent) => void;
  signal: AbortSignal;
  sessionKey: string;
  turnId: string;
  retry: RetryPolicy;
  sleep: (ms: number) => Promise<void>;
}): Promise<StreamOutcome> {
  const {
    provider,
    system,
    messages,
    providerTools,
    emit,
    signal,
    sessionKey,
    turnId,
    retry,
    sleep,
  } = args;

  for (let attempt = 0; attempt < retry.maxAttempts; attempt++) {
    let text = "";
    const toolCalls: ReadyCall[] = [];
    let stop: "tool_use" | "end" | "length" | "refusal" = "end";
    const usage = { inputTokens: 0, outputTokens: 0 };
    let failure:
      { code: string; message: string; retryable: boolean; retryAfterMs?: number } | undefined;

    try {
      for await (const delta of provider.streamTurn({
        system,
        messages,
        tools: providerTools,
        signal,
      })) {
        switch (delta.kind) {
          case "text-start":
            emit({ type: "text-start", sessionKey, turnId, id: delta.id });
            break;
          case "text-delta":
            text += delta.delta;
            emit({ type: "text-delta", sessionKey, turnId, id: delta.id, delta: delta.delta });
            break;
          case "text-end":
            emit({ type: "text-end", sessionKey, turnId, id: delta.id });
            break;
          case "tool-call-start":
            emit({
              type: "tool-call-start",
              sessionKey,
              turnId,
              callId: delta.callId,
              name: delta.name,
            });
            break;
          case "tool-call-delta":
            emit({
              type: "tool-call-delta",
              sessionKey,
              turnId,
              callId: delta.callId,
              argsTextDelta: delta.argsTextDelta,
            });
            break;
          case "tool-call-ready":
            toolCalls.push({ callId: delta.callId, name: delta.name, args: delta.args });
            emit({
              type: "tool-call-ready",
              sessionKey,
              turnId,
              callId: delta.callId,
              name: delta.name,
              args: delta.args,
            });
            break;
          case "usage":
            usage.inputTokens = delta.inputTokens;
            usage.outputTokens = delta.outputTokens;
            break;
          case "stop":
            stop = delta.reason;
            break;
          case "error":
            failure = delta;
            break;
        }
        if (failure) {
          break;
        }
      }
    } catch (error) {
      if (signal.aborted) {
        return { kind: "aborted" };
      }
      failure = classifyFetchError(error);
    }

    if (signal.aborted) {
      return { kind: "aborted" };
    }
    if (!failure) {
      return { kind: "ok", text, toolCalls, stop, usage };
    }

    emit({
      type: "error",
      sessionKey,
      turnId,
      code: failure.code,
      message: failure.message,
      retryable: failure.retryable,
    });
    const hasMoreAttempts = attempt < retry.maxAttempts - 1;
    if (failure.retryable && hasMoreAttempts) {
      await sleep(backoffMs(attempt, retry, failure.retryAfterMs));
      if (signal.aborted) {
        return { kind: "aborted" };
      }
      continue;
    }
    return { kind: "error" };
  }
  return { kind: "error" };
}

/**
 * Execute a turn's tool calls: read-only tools concurrently, mutating tools serially in
 * call order (SPEC §14.4). Abort-safe: a mutating call whose signal is already aborted is
 * NEVER started (so an aborted turn cannot orphan a half-applied write); in-flight calls
 * are awaited to completion. Emits one `tool-result` per call as it resolves.
 */
async function executeToolCalls(args: {
  toolCalls: ReadyCall[];
  toolByName: Map<string, AgentTool>;
  emit: (event: AgentStreamEvent) => void;
  signal: AbortSignal;
  sessionKey: string;
  turnId: string;
}): Promise<Map<string, ToolOutcome>> {
  const { toolCalls, toolByName, emit, signal, sessionKey, turnId } = args;
  const outcomes = new Map<string, ToolOutcome>();

  const runOne = async (call: ReadyCall): Promise<void> => {
    const tool = toolByName.get(call.name);
    if (!tool) {
      const message = `unknown tool: ${call.name}`;
      emit({
        type: "tool-result",
        sessionKey,
        turnId,
        callId: call.callId,
        ok: false,
        error: { code: "unknown_tool", message, retryable: false },
      });
      outcomes.set(call.callId, { ok: false, value: { error: message } });
      return;
    }
    try {
      const { details } = await tool.execute(call.callId, call.args);
      emit({
        type: "tool-result",
        sessionKey,
        turnId,
        callId: call.callId,
        ok: true,
        result: details,
      });
      outcomes.set(call.callId, { ok: true, value: details });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({
        type: "tool-result",
        sessionKey,
        turnId,
        callId: call.callId,
        ok: false,
        error: { code: "tool_error", message, retryable: false },
      });
      outcomes.set(call.callId, { ok: false, value: { error: message } });
    }
  };

  const reads: ReadyCall[] = [];
  const writes: ReadyCall[] = [];
  for (const call of toolCalls) {
    if (toolByName.get(call.name)?.readOnly) {
      reads.push(call);
    } else {
      writes.push(call);
    }
  }

  // Reads: kick off together (parallel). Writes: one at a time, in order.
  const readWork = reads.map((call) => (signal.aborted ? Promise.resolve() : runOne(call)));
  const writeWork = (async () => {
    for (const call of writes) {
      if (signal.aborted) {
        return;
      }
      await runOne(call);
    }
  })();
  await Promise.all([...readWork, writeWork]);
  return outcomes;
}

/** Run one agent turn end-to-end, emitting the full `AgentStreamEvent` stream. */
export async function runAgentTurn(options: RunAgentTurnOptions): Promise<RunAgentTurnResult> {
  const {
    tools,
    provider,
    system,
    userMessage,
    emit,
    signal,
    sessionKey,
    turnId,
    tokenCeiling,
    maxToolIterations = DEFAULT_MAX_TOOL_ITERATIONS,
    retry = DEFAULT_RETRY_POLICY,
    sleep = realSleep,
  } = options;

  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  const providerTools: ProviderTool[] = tools.map((tool) => {
    const schema = agentToolToJsonSchema(tool);
    return { name: schema.name, description: schema.description, parameters: schema.inputSchema };
  });

  // The first message is the human turn; subsequent user/tool messages are appended by
  // the adapter's formatToolResult (a plain string content is valid for both providers).
  const messages: ProviderMessage[] = [
    ...(options.history ?? []),
    { role: "user", content: userMessage },
  ];
  const usage = { inputTokens: 0, outputTokens: 0 };

  emit({ type: "turn-start", sessionKey, turnId });

  const finish = (stopReason: ChatStopReason): RunAgentTurnResult => {
    emit({ type: "turn-end", sessionKey, turnId, stopReason });
    return { stopReason, messages, usage };
  };
  const abortFinish = (): RunAgentTurnResult => {
    emit({ type: "abort", sessionKey, turnId });
    emit({ type: "turn-end", sessionKey, turnId, stopReason: "aborted" });
    return { stopReason: "aborted", messages, usage };
  };

  if (signal.aborted) {
    return abortFinish();
  }

  for (let iteration = 0; iteration < maxToolIterations; iteration++) {
    const streamed = await streamOneProviderTurn({
      provider,
      system,
      messages,
      providerTools,
      emit,
      signal,
      sessionKey,
      turnId,
      retry,
      sleep,
    });

    if (streamed.kind === "aborted" || signal.aborted) {
      return abortFinish();
    }
    if (streamed.kind === "error") {
      return finish("end");
    }

    usage.inputTokens += streamed.usage.inputTokens;
    usage.outputTokens += streamed.usage.outputTokens;
    emit({
      type: "usage",
      sessionKey,
      turnId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });

    if (streamed.text.length > 0 || streamed.toolCalls.length > 0) {
      const turn: AssistantTurn = { text: streamed.text, toolCalls: streamed.toolCalls };
      messages.push(provider.formatAssistantTurn(turn));
    }

    if (streamed.stop !== "tool_use" || streamed.toolCalls.length === 0) {
      const reason: ChatStopReason =
        streamed.stop === "length" ? "length" : streamed.stop === "refusal" ? "refusal" : "end";
      return finish(reason);
    }

    const outcomes = await executeToolCalls({
      toolCalls: streamed.toolCalls,
      toolByName,
      emit,
      signal,
      sessionKey,
      turnId,
    });
    // Append tool results in call order so the provider history pairs tool_use↔tool_result.
    for (const call of streamed.toolCalls) {
      const outcome = outcomes.get(call.callId);
      if (outcome) {
        messages.push(provider.formatToolResult(call.callId, outcome));
      }
    }

    if (signal.aborted) {
      return abortFinish();
    }
    if (usage.inputTokens + usage.outputTokens > tokenCeiling) {
      return finish("length");
    }
  }

  return finish("max-iterations");
}
