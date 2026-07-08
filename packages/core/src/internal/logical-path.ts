// Browser-safe joining for LOGICAL storage keys (never real filesystem paths).
//
// The store addresses documents by logical keys (`dashboard/workspace.json`,
// `dashboard/state/<id>.json`); the injected StorageAdapter decides what they
// mean — the fs adapter maps them onto disk, the memory adapter uses them as Map
// keys. Keeping this off `node:path` is what lets `@boardstate/core` load in a
// browser. Segments always join with a forward slash; empty segments are dropped
// and duplicate slashes collapse, so the result is a stable canonical key.
export const LOGICAL_SEP = "/";

export function joinLogical(...segments: string[]): string {
  return segments
    .filter((segment) => segment.length > 0)
    .join(LOGICAL_SEP)
    .replace(/\/{2,}/g, LOGICAL_SEP);
}
