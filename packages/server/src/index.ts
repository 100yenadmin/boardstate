// Browser-safe surface of @boardstate/server: the control plane.
//
// - The `ServerHost` seam and the in-process reference host (`createInProcessHost`),
//   which is also a `Transport` — what the conformance suite and example app drive.
// - The control-plane protocol registration (`registerBoardstateRpc`) — SPEC §4–5,
//   §10, plus the shipped extensions (write-back, history, install, presence).
//
// This entry imports ZERO `node:*`, so it loads in a browser over an in-process
// host + `MemoryStorageAdapter`. The fs-backed pieces — widget serving, the bundle
// installer, agent-tool custom-widget scaffolding, and the CLI — live in
// `@boardstate/server/node`. File-binding resolution and gallery install are
// injected into `registerBoardstateRpc` by node hosts (see `nodeRpcDeps` there).

export type {
  ServerHost,
  RpcScope,
  RpcHandler,
  RpcHandlerContext,
  ToolContext,
  RequestContext,
  AgentTool,
  AgentToolResult,
  NodeHttpHandler,
  InProcessHost,
  CreateInProcessHostOptions,
} from "./host.js";
export { createInProcessHost, formatError, toolJson, agentToolToJsonSchema } from "./host.js";

export {
  registerBoardstateRpc,
  type RegisterBoardstateRpcOptions,
  type WidgetBundleInstaller,
  type BindingResolver,
} from "./rpc.js";

// Chat & agent-turn protocol plumbing (SPEC §14) — browser-safe.
export {
  createChatSessions,
  registerChatRpc,
  type ChatSessions,
  type CreateChatSessionsOptions,
  type ChatEmitter,
  type ChatAgent,
  type ChatAgentContext,
  type RegisterChatRpcOptions,
} from "./chat.js";

// Pure CLI parsers (no fs) are handy for browser tooling too.
export {
  parseDashboardGrid,
  parseDashboardBindingShorthand,
  parseBindings,
} from "./cli/parsers.js";
