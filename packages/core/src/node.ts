// The `@boardstate/core/node` entry: everything that needs a Node runtime, kept
// out of the browser-safe main entry (`./index.ts`). A Node host imports the fs
// storage adapter and the fs-backed resolvers from here; a browser host never
// touches this file. `resolveBinding` here is the full resolver (file included);
// the main entry's `resolveBinding` errors on `file` bindings.

export { FsStorageAdapter, BOARDSTATE_STATE_DIR_ENV } from "./adapters/storage-fs.js";
export { resolveWidgetDir, loadWidgetManifest } from "./manifest-node.js";
export { resolveBinding, resolveFileBinding } from "./data-read-node.js";
