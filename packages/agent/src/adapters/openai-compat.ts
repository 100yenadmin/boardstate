// The OpenAI-compatible `/chat/completions` adapter — the GLM/z.ai, OpenAI, Together,
// and Ollama path. Parses `stream=true` chunks, accumulating tool-call argument
// fragments BY callId (never by array index): a fragment carrying a `function.name`
// opens a new call (synthesizing `${name}_${seq}` when the id is missing or duplicated),
// and nameless fragments append arguments to the call at their index. This is the
// documented Ollama compat fix — parallel calls all report `index:0`, so index-keying
// would silently merge them (ROADMAP delta 3).

import type {
  AssistantTurn,
  ProviderAdapter,
  ProviderDelta,
  ProviderStopReason,
  ProviderStreamRequest,
  ToolOutcome,
} from "../types.js";
import { classifyFetchError, isRetryableStatus, parseRetryAfter } from "../errors.js";
import { readSse } from "./sse.js";
import { parseJsonOr, safeText, stringifyValue } from "./util.js";

export type OpenAICompatAdapterOptions = {
  /** The API root, e.g. `https://api.openai.com/v1` or `https://api.z.ai/api/paas/v4`. */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
};

type OpenAiToolCallDelta = {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

type OpenAiSseJson = {
  choices?: Array<{
    index?: number;
    delta?: { role?: string; content?: string; tool_calls?: OpenAiToolCallDelta[] };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

type OpenCall = { callId: string; name: string; argsText: string };

function mapFinish(reason: string | null | undefined): ProviderStopReason {
  switch (reason) {
    case "tool_calls":
    case "function_call":
      return "tool_use";
    case "length":
      return "length";
    case "content_filter":
      return "refusal";
    default:
      // "stop", null, unknown.
      return "end";
  }
}

async function* streamOpenAI(
  request: ProviderStreamRequest,
  cfg: { baseUrl: string; doFetch: typeof fetch; apiKey: string; model: string },
): AsyncGenerator<ProviderDelta> {
  let response: Response;
  try {
    response = await cfg.doFetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: request.messages,
        tools: request.tools.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        })),
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted) {
      yield { kind: "stop", reason: "end" };
      return;
    }
    const info = classifyFetchError(error);
    yield { kind: "error", ...info };
    return;
  }

  if (!response.ok || !response.body) {
    const body = await safeText(response);
    yield {
      kind: "error",
      code: `http_${response.status}`,
      message: `OpenAI-compat ${response.status}: ${body}`.trim(),
      retryable: isRetryableStatus(response.status),
      retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
    };
    return;
  }

  const calls: OpenCall[] = [];
  const byId = new Map<string, OpenCall>();
  const byIndex = new Map<number, OpenCall>();
  let seq = 0;
  let textId: string | undefined;
  let stop: ProviderStopReason = "end";
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    for await (const frame of readSse(response.body, request.signal)) {
      if (request.signal.aborted) {
        break;
      }
      if (frame.data === "[DONE]") {
        break;
      }
      const json = parseJsonOr<OpenAiSseJson | undefined>(frame.data, undefined);
      if (!json) {
        continue;
      }
      if (json.usage) {
        inputTokens = json.usage.prompt_tokens ?? inputTokens;
        outputTokens = json.usage.completion_tokens ?? outputTokens;
      }
      const choice = json.choices?.[0];
      if (!choice) {
        continue;
      }
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string" && delta.content.length > 0) {
        if (textId === undefined) {
          textId = "msg_text";
          yield { kind: "text-start", id: textId };
        }
        yield { kind: "text-delta", id: textId, delta: delta.content };
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const index = typeof tc.index === "number" ? tc.index : 0;
          const name = tc.function?.name;
          const fragment = tc.function?.arguments ?? "";
          if (typeof name === "string" && name.length > 0) {
            // A name marks a NEW call boundary (delta 3): key by a fresh callId, never index.
            const callId = tc.id && !byId.has(tc.id) ? tc.id : `${name || "call"}_${seq}`;
            seq += 1;
            const call: OpenCall = { callId, name, argsText: "" };
            calls.push(call);
            byId.set(callId, call);
            byIndex.set(index, call);
            yield { kind: "tool-call-start", callId, name };
            if (fragment) {
              call.argsText += fragment;
              yield { kind: "tool-call-delta", callId, argsTextDelta: fragment };
            }
          } else if (fragment) {
            // A nameless fragment continues the call opened at this index (well-behaved
            // OpenAI streaming), falling back to the id or the most recent open call.
            const call =
              byIndex.get(index) ??
              (tc.id ? byId.get(tc.id) : undefined) ??
              calls[calls.length - 1];
            if (call) {
              call.argsText += fragment;
              yield { kind: "tool-call-delta", callId: call.callId, argsTextDelta: fragment };
            }
          }
        }
      }
      if (choice.finish_reason) {
        stop = mapFinish(choice.finish_reason);
      }
    }
  } catch (error) {
    if (request.signal.aborted) {
      yield { kind: "stop", reason: "end" };
      return;
    }
    const info = classifyFetchError(error);
    yield { kind: "error", ...info };
    return;
  }

  if (textId !== undefined) {
    yield { kind: "text-end", id: textId };
  }
  for (const call of calls) {
    yield {
      kind: "tool-call-ready",
      callId: call.callId,
      name: call.name,
      args: parseJsonOr<Record<string, unknown>>(call.argsText, {}),
    };
  }
  yield { kind: "usage", inputTokens, outputTokens };
  yield { kind: "stop", reason: stop };
}

/** Build an OpenAI-compatible `/chat/completions` provider adapter. */
export function openAICompatAdapter(options: OpenAICompatAdapterOptions): ProviderAdapter {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch;

  return {
    id: "openai-compat",
    streamTurn(request) {
      return streamOpenAI(request, {
        baseUrl,
        doFetch,
        apiKey: options.apiKey,
        model: options.model,
      });
    },
    formatToolResult(callId: string, outcome: ToolOutcome) {
      const text = stringifyValue(outcome.value);
      return {
        role: "tool",
        tool_call_id: callId,
        content: outcome.ok ? text : `Error: ${text}`,
      };
    },
    formatAssistantTurn(turn: AssistantTurn) {
      if (turn.toolCalls.length === 0) {
        return { role: "assistant", content: turn.text };
      }
      return {
        role: "assistant",
        content: turn.text.length > 0 ? turn.text : null,
        tool_calls: turn.toolCalls.map((call) => ({
          id: call.callId,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
        })),
      };
    },
  };
}
