// `createAgentChatAgent` — the adapter from a `ProviderAdapter` to a `ChatAgent`, the
// exact shape `registerBoardstateRpc({ chatAgent })` / `chat.send` plug into. It builds
// the tool schemas + system prompt, keeps per-session provider-native message history in
// memory (truncation-first: at 75% of the token ceiling the oldest tool-result CONTENTS
// are elided, keeping the dialogue), and runs `runAgentTurn` for each turn.

import type { ChatAgent, ChatAgentContext } from "@boardstate/server";
import type { AgentTool } from "@boardstate/server";
import { runAgentTurn } from "./runner.js";
import { buildSystemPrompt } from "./system-prompt.js";
import type { ProviderAdapter, ProviderMessage } from "./types.js";

const DEFAULT_TOKEN_CEILING = 100_000;
/** History is truncated back under this fraction of the token ceiling before a turn. */
const TRUNCATE_AT = 0.75;

export type CreateAgentChatAgentOptions = {
  provider: ProviderAdapter;
  /** Provide EITHER a host (its `tools()` are used) OR an explicit tool set. */
  host?: { tools(): AgentTool[] };
  tools?: AgentTool[];
  /** Appended to the built-in system prompt (e.g. app-specific guidance). */
  systemExtras?: string;
  /** Per-turn token ceiling passed to `runAgentTurn` (default 100k). */
  tokenCeiling?: number;
  /** Tool-iteration ceiling passed to `runAgentTurn` (default 20). */
  maxToolIterations?: number;
  /**
   * The self-building loop (SPEC §15, M4a). `"once"` appends ONE bounded follow-up
   * pass after any turn that mutated the board: the model is asked to call
   * `dashboard_design_review`, fix the findings it agrees with, and summarize. Same
   * ceilings; the wire stays ONE §14 turn (a single turn-start/turn-end pair).
   * Default `"off"`.
   */
  selfReview?: "off" | "once";
};

/** The synthetic user message driving the self-review pass (never shown in the UI). */
const SELF_REVIEW_PROMPT =
  "Review the board you just changed: call dashboard_design_review, fix the findings " +
  "you agree with using the dashboard tools (skip any you disagree with), then " +
  "summarize what you changed in one short message. If nothing is worth fixing, say " +
  "so in one sentence.";

/** True for a provider-native tool-result message (Anthropic user/tool_result or OpenAI tool). */
function isToolResultMessage(message: ProviderMessage): boolean {
  if (message.role === "tool") {
    return true;
  }
  if (message.role === "user" && Array.isArray(message.content)) {
    return message.content.some(
      (block) =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "tool_result",
    );
  }
  return false;
}

/** Replace a tool-result message's payload with a short placeholder, keeping the envelope. */
function elideToolResult(message: ProviderMessage): ProviderMessage {
  if (message.role === "tool") {
    return { ...message, content: "[elided]" };
  }
  if (message.role === "user" && Array.isArray(message.content)) {
    return {
      ...message,
      content: message.content.map((block) =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "tool_result"
          ? { ...(block as Record<string, unknown>), content: "[elided]" }
          : block,
      ),
    };
  }
  return message;
}

function estimateTokens(messages: ProviderMessage[]): number {
  // A cheap, dependency-free heuristic (~4 chars/token) — good enough to bound context.
  return Math.ceil(JSON.stringify(messages).length / 4);
}

/**
 * Truncation-first context management: while the history estimate exceeds 75% of the
 * token ceiling, elide the oldest tool-result contents (never the dialogue). Returns a
 * fresh array; the input is not mutated.
 */
export function truncateHistory(
  messages: ProviderMessage[],
  tokenCeiling: number,
): ProviderMessage[] {
  const budget = tokenCeiling * TRUNCATE_AT;
  const result = messages.map((message) => ({ ...message }));
  for (let i = 0; i < result.length && estimateTokens(result) > budget; i++) {
    const message = result[i];
    if (message && isToolResultMessage(message)) {
      result[i] = elideToolResult(message);
    }
  }
  return result;
}

/** Build a `ChatAgent` that drives a provider over the control-plane tool set. */
export function createAgentChatAgent(options: CreateAgentChatAgentOptions): ChatAgent {
  if (!options.host && !options.tools) {
    throw new Error("createAgentChatAgent requires either `host` or `tools`");
  }
  const tokenCeiling = options.tokenCeiling ?? DEFAULT_TOKEN_CEILING;
  const histories = new Map<string, ProviderMessage[]>();

  return async ({ sessionKey, message }, ctx: ChatAgentContext) => {
    const tools = options.tools ?? options.host!.tools();
    const system =
      buildSystemPrompt(tools) + (options.systemExtras ? `\n\n${options.systemExtras}` : "");
    const history = truncateHistory(histories.get(sessionKey) ?? [], tokenCeiling);

    // Self-review plumbing: watch for a mutating tool call, and if a review pass may
    // follow, hold back the first pass's `turn-end` so the wire stays ONE §14 turn.
    const wantsReview = options.selfReview === "once";
    const mutatingTools = new Set(tools.filter((tool) => !tool.readOnly).map((tool) => tool.name));
    let sawMutation = false;
    let heldTurnEnd: Parameters<ChatAgentContext["emit"]>[0] | null = null;
    const firstEmit: ChatAgentContext["emit"] = (event) => {
      if (event.type === "tool-call-ready" && mutatingTools.has(event.name)) {
        sawMutation = true;
      }
      if (wantsReview && event.type === "turn-end") {
        heldTurnEnd = event;
        return;
      }
      ctx.emit(event);
    };

    const result = await runAgentTurn({
      tools,
      provider: options.provider,
      system,
      history,
      userMessage: message,
      emit: firstEmit,
      signal: ctx.signal,
      sessionKey,
      turnId: ctx.turnId,
      tokenCeiling,
      maxToolIterations: options.maxToolIterations,
    });

    const shouldReview =
      wantsReview && sawMutation && result.stopReason === "end" && !ctx.signal.aborted;
    if (!shouldReview) {
      if (heldTurnEnd) {
        ctx.emit(heldTurnEnd); // release the held terminal — the turn ends here after all
      }
      // An aborted turn can leave an assistant tool_use without its results — don't
      // persist that partial exchange (it would break the next turn's provider history).
      if (result.stopReason !== "aborted") {
        histories.set(sessionKey, truncateHistory(result.messages, tokenCeiling));
      }
      return;
    }

    // The bounded review pass: max ONE extra run, same ceilings. Its `turn-start` is
    // swallowed (the turn is already open); its `turn-end` is the turn's real terminal.
    const reviewEmit: ChatAgentContext["emit"] = (event) => {
      if (event.type === "turn-start") {
        return;
      }
      ctx.emit(event);
    };
    const reviewResult = await runAgentTurn({
      tools,
      provider: options.provider,
      system,
      history: truncateHistory(result.messages, tokenCeiling),
      userMessage: SELF_REVIEW_PROMPT,
      emit: reviewEmit,
      signal: ctx.signal,
      sessionKey,
      turnId: ctx.turnId,
      tokenCeiling,
      maxToolIterations: options.maxToolIterations,
    });

    if (reviewResult.stopReason !== "aborted") {
      histories.set(sessionKey, truncateHistory(reviewResult.messages, tokenCeiling));
    } else {
      // Keep the completed build exchange; drop only the partial review exchange.
      histories.set(sessionKey, truncateHistory(result.messages, tokenCeiling));
    }
  };
}
