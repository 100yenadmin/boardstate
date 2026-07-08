// Public surface of @boardstate/core: the headless runtime for a Boardstate host.
//
// - Storage / transport adapters (the seams a host injects).
// - The validated workspace store (serialized writes, undo ring, widget state,
//   ephemeral TTL sweep, time-travel history).
// - Server-side binding resolution + the custom-widget manifest validator.
// - Response-time private-tab visibility filtering + the tab-scoped pub/sub broker.
// - Client-side read-model logic: defensive workspace normalization, tab queries,
//   JSON-pointer application, export/import, and the pure builtin-widget transforms.
//
// The workspace document schema + validators live in `@boardstate/schema`; import
// those directly.

export type { StorageAdapter } from "./adapters/storage.js";
export type { Transport } from "./adapters/transport.js";
export { FsStorageAdapter, BOARDSTATE_STATE_DIR_ENV } from "./adapters/storage-fs.js";
export { MemoryStorageAdapter } from "./adapters/storage-memory.js";

export * from "./store.js";
export * from "./data-read.js";
export * from "./manifest.js";
export * from "./visibility.js";
export * from "./bus.js";
export * from "./types.js";
export * from "./grid.js";
export * from "./distribution.js";
export * from "./queries.js";
export * from "./transforms/index.js";
