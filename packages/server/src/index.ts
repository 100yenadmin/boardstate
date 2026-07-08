// Public surface of @boardstate/server: the control plane + serving + agent tools +
// CLI for a Boardstate host.
//
// - The `ServerHost` seam and the in-process reference host (`createInProcessHost`),
//   which is also a `Transport` — what the conformance suite and example app drive.
// - The control-plane protocol registration (`registerBoardstateRpc`) — SPEC §4–5,
//   §10, plus the shipped extensions (write-back, history, install, presence).
// - The agent-facing `dashboard_*` tools + custom-widget scaffolding.
// - Static widget-asset serving (SPEC §9) + its HTTP route adapter.
// - The client-fetched widget bundle installer (SPEC §8.2) and the CLI.
//
// The workspace schema/validators live in `@boardstate/schema`; the headless store,
// binding resolution, manifest validation, and visibility filter in `@boardstate/core`.

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
export { createInProcessHost, formatError, toolJson } from "./host.js";

export { registerBoardstateRpc, type RegisterBoardstateRpcOptions } from "./rpc.js";

export {
  createDashboardTools,
  type DashboardToolParams,
  type DashboardBroadcast,
} from "./tools.js";

export {
  scaffoldDashboardWidget,
  type DashboardScaffoldOptions,
  type DashboardScaffoldResult,
} from "./scaffold.js";

export {
  serveWidgetAsset,
  parseWidgetRequestPath,
  isWidgetRoutePath,
  isServableWidgetFile,
  normalizeWidgetLogicalPath,
  WIDGET_CSP,
  WIDGETS_ROUTE_PREFIX,
  type WidgetServeDeps,
  type WidgetServeRequest,
} from "./serve.js";

export { createWidgetHttpRouteHandler } from "./http-route.js";

export {
  installWidgetBundle,
  WIDGET_BUNDLE_MAX_BYTES,
  WIDGET_BUNDLE_MAX_FILES,
  type WidgetBundleInput,
  type InstallWidgetOptions,
} from "./install.js";

export { registerDashboardCli, type RegisterDashboardCliOptions } from "./cli/index.js";
export {
  BoardstateClient,
  addClientOptions,
  clientFromOptions,
  type ClientOptions,
} from "./cli/client.js";
export {
  parseDashboardGrid,
  parseDashboardBindingShorthand,
  parseBindings,
} from "./cli/parsers.js";
