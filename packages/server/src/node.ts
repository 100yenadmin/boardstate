// The `@boardstate/server/node` entry: the fs-backed control-plane pieces a Node
// host needs — widget-asset serving (SPEC §9), the client-fetched bundle installer
// (SPEC §8.2), the agent `dashboard_*` tools + custom-widget scaffolding, and the
// CLI. Re-exports the browser-safe control plane too, so a node host can import
// everything from here.

import { resolveBinding as nodeResolveBinding } from "@boardstate/core/node";
import type { BindingResolver, WidgetBundleInstaller } from "./rpc.js";
import { installWidgetBundle } from "./install.js";

export * from "./index.js";

export { createDashboardTools, type DashboardToolParams } from "./tools-node.js";
export { OPERATOR_ONLY_METHODS } from "./ws-transport.js";

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
  attachWsTransport,
  DEFAULT_FORWARDED_EVENTS,
  type AttachWsTransportOptions,
  type WsTransportHandle,
} from "./ws-transport.js";

// The M5 trust layer's server-enforced half (SPEC §17.1 tool grants + §18 pending
// actions): grant registration + the pending-action engine, wired onto a host and
// fed a broker through the narrow `ActionBroker` interface (no `@boardstate/broker`
// import — the real `McpBroker` fits it structurally).
export {
  installBrokerActions,
  ACTION_EVENT,
  type ActionBroker,
  type ActionToolManifest,
  type ActionToolManifestEntry,
  type BrokerActionAuditEntry,
  type BrokerActionsHandle,
  type InstallBrokerActionsOptions,
} from "./broker-actions.js";

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

/**
 * The node-side dependencies to inject into `registerBoardstateRpc` so a Node host
 * resolves `file` bindings and serves `dashboard.widget.install`. Spread it in:
 * `registerBoardstateRpc(host, { store, dataRead: { stateDir }, ...nodeRpcDeps() })`.
 */
export function nodeRpcDeps(): {
  resolveBinding: BindingResolver;
  installWidgetBundle: WidgetBundleInstaller;
} {
  return { resolveBinding: nodeResolveBinding, installWidgetBundle };
}
