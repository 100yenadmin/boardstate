// The Anthropic Messages-API adapter. Parses the `stream=true` SSE alphabet
// (`message_start` / `content_block_start|delta|stop` / `message_delta` / `message_stop`)
// into `ProviderDelta`s, accumulating `input_json_delta` fragments per content block and
// parsing them only at `content_block_stop`. Tool results use `is_error`; the assistant
// turn is replayed as text + `tool_use` content blocks.

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

export type AnthropicAdapterOptions = {
  apiKey: string;
  model: string;
  /** Defaults to `https://api.anthropic.com`; set the z.ai anthropic-shaped base as a fallback. */
  baseUrl?: string;
  /** Max output tokens per turn (default 4096). */
  maxTokens?: number;
  /** `anthropic-version` header (default `2023-06-01`). */
  anthropicVersion?: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
};

type AnthropicSseJson = {
  type?: string;
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  index?: number;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
  usage?: { output_tokens?: number };
};

type BlockState = { type: "text" | "tool_use"; id: string; name?: string; buffer: string };

function mapStop(reason: string | undefined): ProviderStopReason {
  switch (reason) {
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "length";
    case "refusal":
      return "refusal";
    default:
      // end_turn, stop_sequence, pause_turn, unknown.
      return "end";
  }
}

async function* streamAnthropic(
  request: ProviderStreamRequest,
  cfg: {
    baseUrl: string;
    doFetch: typeof fetch;
    apiKey: string;
    model: string;
    maxTokens: number;
    version: string;
  },
): AsyncGenerator<ProviderDelta> {
  let response: Response;
  try {
    response = await cfg.doFetch(`${cfg.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": cfg.version,
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        system: request.system,
        messages: request.messages,
        tools: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        })),
        stream: true,
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
      message: `Anthropic ${response.status}: ${body}`.trim(),
      retryable: isRetryableStatus(response.status),
      retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
    };
    return;
  }

  const blocks = new Map<number, BlockState>();
  let inputTokens = 0;
  let outputTokens = 0;
  let stop: ProviderStopReason = "end";

  try {
    for await (const frame of readSse(response.body, request.signal)) {
      if (request.signal.aborted) {
        break;
      }
      if (frame.data === "[DONE]") {
        break;
      }
      const json = parseJsonOr<AnthropicSseJson | undefined>(frame.data, undefined);
      if (!json) {
        continue;
      }
      const type = frame.event ?? json.type;
      switch (type) {
        case "message_start": {
          inputTokens = json.message?.usage?.input_tokens ?? 0;
          outputTokens = json.message?.usage?.output_tokens ?? 0;
          break;
        }
        case "content_block_start": {
          const index = json.index ?? 0;
          const block = json.content_block;
          if (block?.type === "tool_use") {
            const callId = block.id ?? `tool_${index}`;
            blocks.set(index, { type: "tool_use", id: callId, name: block.name, buffer: "" });
            yield { kind: "tool-call-start", callId, name: block.name ?? "" };
          } else {
            const id = `text_${index}`;
            blocks.set(index, { type: "text", id, buffer: "" });
            yield { kind: "text-start", id };
          }
          break;
        }
        case "content_block_delta": {
          const block = blocks.get(json.index ?? 0);
          if (!block) {
            break;
          }
          const delta = json.delta;
          if (delta?.type === "text_delta") {
            yield { kind: "text-delta", id: block.id, delta: delta.text ?? "" };
          } else if (delta?.type === "input_json_delta") {
            const fragment = delta.partial_json ?? "";
            block.buffer += fragment;
            yield { kind: "tool-call-delta", callId: block.id, argsTextDelta: fragment };
          }
          break;
        }
        case "content_block_stop": {
          const block = blocks.get(json.index ?? 0);
          if (!block) {
            break;
          }
          if (block.type === "text") {
            yield { kind: "text-end", id: block.id };
          } else {
            yield {
              kind: "tool-call-ready",
              callId: block.id,
              name: block.name ?? "",
              args: parseJsonOr<Record<string, unknown>>(block.buffer, {}),
            };
          }
          break;
        }
        case "message_delta": {
          if (json.delta?.stop_reason) {
            stop = mapStop(json.delta.stop_reason);
          }
          if (json.usage?.output_tokens != null) {
            outputTokens = json.usage.output_tokens;
          }
          break;
        }
        default:
          break;
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

  yield { kind: "usage", inputTokens, outputTokens };
  yield { kind: "stop", reason: stop };
}

/** Build an Anthropic Messages-API provider adapter. */
export function anthropicAdapter(options: AnthropicAdapterOptions): ProviderAdapter {
  const baseUrl = (options.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch;
  const maxTokens = options.maxTokens ?? 4096;
  const version = options.anthropicVersion ?? "2023-06-01";

  return {
    id: "anthropic",
    streamTurn(request) {
      return streamAnthropic(request, {
        baseUrl,
        doFetch,
        apiKey: options.apiKey,
        model: options.model,
        maxTokens,
        version,
      });
    },
    formatToolResult(callId: string, outcome: ToolOutcome) {
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: callId,
            content: stringifyValue(outcome.value),
            is_error: !outcome.ok,
          },
        ],
      };
    },
    formatAssistantTurn(turn: AssistantTurn) {
      const content: Array<Record<string, unknown>> = [];
      if (turn.text.length > 0) {
        content.push({ type: "text", text: turn.text });
      }
      for (const call of turn.toolCalls) {
        content.push({
          type: "tool_use",
          id: call.callId,
          name: call.name,
          input: call.args ?? {},
        });
      }
      if (content.length === 0) {
        content.push({ type: "text", text: "" });
      }
      return { role: "assistant", content };
    },
  };
}
