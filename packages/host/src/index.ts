// Public surface of @boardstate/host: the DOM-side host for a Boardstate client.
//
// - The framework-free custom-widget postMessage bridge (security gates, rate
//   limits, state + pub/sub message handling) and the shared prompt dispatch gate.
// - The transport-backed store: workspace load, the live `boardstate.changed`
//   subscription, optimistic mutations, client-side binding resolution
//   (rpc/file/stream/computed), and workspace export/import.
// - The iframe mount (`mountCustomWidget`) and the widget-id-bound state accessor.
// - Pending custom-widget approvals, the resolved-binding cache, and manifest load.
//
// The workspace schema lives in `@boardstate/schema`; the headless read-model,
// adapters, and server-side logic live in `@boardstate/core`.

export * from "./bridge.js";
export * from "./store.js";
export * from "./mount.js";
export * from "./approval.js";
export * from "./bindings-cache.js";
export * from "./manifests.js";
