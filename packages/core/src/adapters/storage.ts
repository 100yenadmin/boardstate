// The storage seam the headless store writes through. A host injects one impl so
// the store never touches `node:fs` directly — the fs adapter provides the
// atomic-write + jail semantics, the memory adapter backs tests and conformance.
//
// All paths are absolute. `readFile` returns `null` (never throws) when the file
// is absent; `readdir` returns `[]` for a missing directory; `rm` is force+
// recursive (never throws on a missing target). `writeFileAtomic` MUST land the
// content atomically (temp file in the same dir, rename over) so a torn write can
// never leave a partial document on disk (§11-I8).
export interface StorageAdapter {
  /** Absolute base state dir (e.g. `~/.boardstate`); the store roots every path here. */
  storageDir(): string;
  writeFileAtomic(path: string, content: string, opts?: { mode?: number }): Promise<void>;
  readFile(path: string): Promise<string | null>;
  mkdir(path: string, opts?: { mode?: number }): Promise<void>;
  readdir(path: string): Promise<string[]>;
  rm(path: string): Promise<void>;
}
