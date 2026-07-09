// The provider seam of @boardstate/agent (SPEC §14 / ROADMAP M2 "streaming
// normalization" deltas). A `ProviderAdapter` normalizes one vendor's streaming
// wire format into a single `ProviderDelta` alphabet the runner maps 1:1 onto the
// frozen `AgentStreamEvent` bus. Everything here is provider-agnostic; the two shipped
// adapters (anthropic, openai-compat) are the only code that knows a wire shape.

/** How a single provider turn ended, mapped from the vendor's native stop reason. */
export type ProviderStopReason = "tool_use" | "end" | "length" | "refusal";

/**
 * One normalized event from a provider's streaming turn. Text and tool-call blocks use
 * start → delta* → end/ready triads keyed by stable ids so concurrent blocks never
 * collide (ROADMAP delta 1). `tool-call-delta` carries RAW partial arg text — the
 * adapter parses only at block end and emits the parsed object on `tool-call-ready`
 * (delta 2). The adapter MUST end every stream with a terminal `stop` OR `error` delta,
 * even on abort — the runner never trusts a bare fetch rejection (contract 2).
 */
export type ProviderDelta =
  | { kind: "text-start"; id: string }
  | { kind: "text-delta"; id: string; delta: string }
  | { kind: "text-end"; id: string }
  | { kind: "tool-call-start"; callId: string; name: string }
  | { kind: "tool-call-delta"; callId: string; argsTextDelta: string }
  | { kind: "tool-call-ready"; callId: string; name: string; args: unknown }
  | { kind: "usage"; inputTokens: number; outputTokens: number }
  | { kind: "stop"; reason: ProviderStopReason }
  | {
      /** A terminal provider failure. `retryAfterMs` mirrors a `Retry-After` header. */
      kind: "error";
      code: string;
      message: string;
      retryable: boolean;
      retryAfterMs?: number;
    };

/**
 * A provider-native chat message, opaque to the runner — only the adapter that produced
 * it interprets it (Anthropic content blocks vs. OpenAI role/tool_calls). The runner
 * threads these through `streamTurn` unchanged; the adapter owns every translation.
 */
export type ProviderMessage = { role: string } & Record<string, unknown>;

/** A tool advertised to a provider — the JSON-Schema view from `agentToolToJsonSchema`. */
export type ProviderTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/** The request one `streamTurn` call receives. */
export type ProviderStreamRequest = {
  system: string;
  messages: ProviderMessage[];
  tools: ProviderTool[];
  signal: AbortSignal;
};

/**
 * The assistant turn reconstructed from a stream (accumulated text + the parsed tool
 * calls), replayed into provider-native form so the next iteration's request carries the
 * tool_use/tool_calls the appended tool results answer.
 */
export type AssistantTurn = {
  text: string;
  toolCalls: Array<{ callId: string; name: string; args: unknown }>;
};

/** The result of executing one tool call, handed to `formatToolResult`. */
export type ToolOutcome = { ok: boolean; value: unknown };

/**
 * A pluggable provider. `streamTurn` yields the normalized delta stream;
 * `formatToolResult` renders a tool outcome into the vendor's tool-result message
 * (Anthropic `is_error` vs OpenAI text-only — no shared shape exists, delta 4);
 * `formatAssistantTurn` renders the model's own tool-call turn back into a message.
 *
 * NOTE: `formatAssistantTurn` is not in the original packet interface sketch, but it is
 * REQUIRED for a working loop — both Anthropic and OpenAI reject a tool-result message
 * that is not immediately preceded by the matching assistant tool-call turn.
 */
export interface ProviderAdapter {
  readonly id: string;
  streamTurn(request: ProviderStreamRequest): AsyncIterable<ProviderDelta>;
  formatToolResult(callId: string, outcome: ToolOutcome): ProviderMessage;
  formatAssistantTurn(turn: AssistantTurn): ProviderMessage;
}
