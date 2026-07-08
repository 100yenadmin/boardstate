// In-memory StorageAdapter for tests and the conformance harness. Writes are
// trivially "atomic" (a single Map set); the same absolute-path contract as the fs
// adapter holds, so a store driven by this behaves identically to one on disk.

import { LOGICAL_SEP } from "../internal/logical-path.js";
import type { StorageAdapter } from "./storage.js";

export class MemoryStorageAdapter implements StorageAdapter {
  private readonly root: string;
  private readonly files = new Map<string, string>();

  constructor(options: { storageDir?: string } = {}) {
    this.root = options.storageDir ?? "/boardstate";
  }

  storageDir(): string {
    return this.root;
  }

  async writeFileAtomic(filePath: string, content: string): Promise<void> {
    this.files.set(filePath, content);
  }

  async readFile(filePath: string): Promise<string | null> {
    return this.files.get(filePath) ?? null;
  }

  async mkdir(): Promise<void> {
    // Directories are implicit in a flat path→content map; nothing to create.
  }

  async readdir(dirPath: string): Promise<string[]> {
    const prefix = dirPath.endsWith(LOGICAL_SEP) ? dirPath : `${dirPath}${LOGICAL_SEP}`;
    const names = new Set<string>();
    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(prefix)) {
        continue;
      }
      // Only the immediate child segment (basename for a direct file, first dir
      // segment for a nested one) — matching fs.readdir's shallow listing.
      const rest = filePath.slice(prefix.length);
      const segment = rest.split(LOGICAL_SEP)[0];
      if (segment) {
        names.add(segment);
      }
    }
    return [...names];
  }

  async rm(targetPath: string): Promise<void> {
    this.files.delete(targetPath);
    const prefix = `${targetPath}${LOGICAL_SEP}`;
    // Collect matches first, then delete — never mutate the Map mid-iteration.
    const nested: string[] = [];
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        nested.push(filePath);
      }
    }
    for (const filePath of nested) {
      this.files.delete(filePath);
    }
  }
}
