// Chat & agent-turn protocol types (SPEC §14, v0.2). These are the WIRE shapes
// shared by every face of the chat surface: the server's chat.* methods, the
// `builtin:chat` renderer, the agent runner, and the conformance suite. Keep this
// file dependency-free and additive — §14 is a frozen contract; breaking changes
// require a spec version bump.

/** The broadcast event name every AgentStreamEvent travels under (SPEC §14.2). */
export const CHAT_EVENT = "boardstate.chat.event";

/** Why a turn ended (SPEC §14.2). */
export type ChatStopReason = "end" | "length" | "aborted" | "max-iterations" | "refusal";

/** Error payload carried by tool-result and error events. */
export type ChatErrorInfo = {
  code: string;
  message: string;
  /** Honest classification: true only for 429/5xx/timeout-class failures. */
  retryable: boolean;
};

/**
 * The typed event stream of an agent turn (SPEC §14.2). Streamed content uses
 * start → delta* → end triads keyed by stable ids so concurrent blocks never
 * collide. Ordering invariants (conformance-pinned): `turn-start` precedes all;
 * every `*-start` has a matching `*-end` unless the turn ends `aborted`;
 * `tool-call-ready` precedes its `tool-result`; exactly one `turn-end`, last.
 */
export type AgentStreamEvent =
  | { type: "turn-start"; sessionKey: string; turnId: string }
  | { type: "text-start"; sessionKey: string; turnId: string; id: string }
  | { type: "text-delta"; sessionKey: string; turnId: string; id: string; delta: string }
  | { type: "text-end"; sessionKey: string; turnId: string; id: string }
  | { type: "tool-call-start"; sessionKey: string; turnId: string; callId: string; name: string }
  | {
      /** RAW partial tool-args text — a UI affordance only; consumers MUST NOT parse it. */
      type: "tool-call-delta";
      sessionKey: string;
      turnId: string;
      callId: string;
      argsTextDelta: string;
    }
  | {
      type: "tool-call-ready";
      sessionKey: string;
      turnId: string;
      callId: string;
      name: string;
      args: unknown;
    }
  | {
      type: "tool-result";
      sessionKey: string;
      turnId: string;
      callId: string;
      ok: boolean;
      result?: unknown;
      error?: ChatErrorInfo;
    }
  | {
      /** Cumulative within the turn. */
      type: "usage";
      sessionKey: string;
      turnId: string;
      inputTokens: number;
      outputTokens: number;
    }
  | { type: "turn-end"; sessionKey: string; turnId: string; stopReason: ChatStopReason }
  | { type: "abort"; sessionKey: string; turnId: string }
  | {
      type: "error";
      sessionKey: string;
      turnId?: string;
      code: string;
      message: string;
      retryable: boolean;
    };

export type AgentStreamEventType = AgentStreamEvent["type"];

/** Params/result shapes for the chat.* control-plane methods (SPEC §14.1). */
export type ChatSendParams = { sessionKey: string; message: string };
export type ChatSendResult = { turnId: string };
export type ChatHistoryParams = { sessionKey: string };
export type ChatHistoryResult = { events: AgentStreamEvent[] };
export type ChatAbortParams = { sessionKey: string; turnId: string };
