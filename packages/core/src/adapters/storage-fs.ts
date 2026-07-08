// Filesystem-backed StorageAdapter. Ports the atomicity semantics of the source's
// `replaceFileAtomic`: the content is written to a uniquely-named temp file IN THE
// SAME DIRECTORY, then renamed over the target (rename is atomic within a
// filesystem), and the temp file is cleaned up if any step fails — so a torn write
// can never leave a partial or truncated document where the target used to be.

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StorageAdapter } from "./storage.js";

/** Env override for the base state dir; defaults to `~/.boardstate`. */
export const BOARDSTATE_STATE_DIR_ENV = "BOARDSTATE_STATE_DIR";

function defaultStorageDir(): string {
  const fromEnv = process.env[BOARDSTATE_STATE_DIR_ENV];
  if (fromEnv && fromEnv.trim()) {
    return fromEnv;
  }
  return path.join(os.homedir(), ".boardstate");
}

function isNotFoundError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

export class FsStorageAdapter implements StorageAdapter {
  private readonly root: string;

  constructor(options: { storageDir?: string } = {}) {
    this.root = options.storageDir ?? defaultStorageDir();
  }

  storageDir(): string {
    return this.root;
  }

  async writeFileAtomic(
    filePath: string,
    content: string,
    opts: { mode?: number } = {},
  ): Promise<void> {
    const dir = path.dirname(filePath);
    // Temp name in the SAME directory so the rename stays within one filesystem
    // (cross-device renames are not atomic). A random suffix avoids collisions
    // between concurrent writers.
    const tempPath = path.join(
      dir,
      `.${path.basename(filePath)}.${randomBytes(6).toString("hex")}.tmp`,
    );
    try {
      await fs.writeFile(tempPath, content, { mode: opts.mode ?? 0o600 });
      await fs.rename(tempPath, filePath);
    } catch (error) {
      // Cleanup on failure: the target is never touched, and no partial temp leaks.
      await fs.rm(tempPath, { force: true });
      throw error;
    }
  }

  async readFile(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, "utf8");
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async mkdir(dirPath: string, opts: { mode?: number } = {}): Promise<void> {
    await fs.mkdir(dirPath, {
      recursive: true,
      ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
    });
  }

  async readdir(dirPath: string): Promise<string[]> {
    try {
      return await fs.readdir(dirPath);
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }
      throw error;
    }
  }

  async rm(targetPath: string): Promise<void> {
    await fs.rm(targetPath, { force: true, recursive: true });
  }
}
