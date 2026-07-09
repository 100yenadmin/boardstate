// Public surface of @boardstate/agent (ROADMAP M2): the provider loop that turns any LLM
// into a dashboard-building agent — a CLIENT of the control plane, never baked into core.
//
// Browser-safe: this entry imports ZERO `node:*` (`fetch` is universal; provider keys are
// passed IN by the host). Wire it into a server with:
//
//   const chatAgent = createAgentChatAgent({ host, provider: anthropicAdapter({ apiKey, model }) });
//   registerBoardstateRpc(host, { ...opts, chat: sessions, chatAgent });

export { runAgentTurn, type RunAgentTurnOptions, type RunAgentTurnResult } from "./runner.js";
export {
  createAgentChatAgent,
  truncateHistory,
  type CreateAgentChatAgentOptions,
} from "./chat-agent.js";
export { buildSystemPrompt, compositionGuideTool, COMPOSITION_GUIDE } from "./system-prompt.js";
export { anthropicAdapter, type AnthropicAdapterOptions } from "./adapters/anthropic.js";
export { openAICompatAdapter, type OpenAICompatAdapterOptions } from "./adapters/openai-compat.js";
export {
  DEFAULT_RETRY_POLICY,
  isRetryableStatus,
  classifyFetchError,
  parseRetryAfter,
  backoffMs,
  type RetryPolicy,
  type FailureInfo,
} from "./errors.js";
export type {
  ProviderAdapter,
  ProviderDelta,
  ProviderMessage,
  ProviderTool,
  ProviderStreamRequest,
  ProviderStopReason,
  AssistantTurn,
  ToolOutcome,
} from "./types.js";
