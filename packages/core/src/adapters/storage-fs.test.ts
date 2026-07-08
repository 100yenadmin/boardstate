import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FsStorageAdapter } from "./storage-fs.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "boardstate-fs-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("FsStorageAdapter", () => {
  it("round-trips a file and replaces existing content atomically", async () => {
    const adapter = new FsStorageAdapter({ storageDir: root });
    const target = path.join(root, "workspace.json");
    await adapter.writeFileAtomic(target, "one");
    expect(await adapter.readFile(target)).toBe("one");
    await adapter.writeFileAtomic(target, "two");
    expect(await adapter.readFile(target)).toBe("two");
  });

  it("leaves no temp files behind on a successful write", async () => {
    const adapter = new FsStorageAdapter({ storageDir: root });
    await adapter.writeFileAtomic(path.join(root, "workspace.json"), "content");
    const entries = await fs.readdir(root);
    expect(entries).toEqual(["workspace.json"]);
  });

  it("cleans up the temp file and leaves the target untouched when the rename fails", async () => {
    const adapter = new FsStorageAdapter({ storageDir: root });
    // A non-empty directory at the target path makes the rename-over fail; the temp
    // file must be cleaned up (torn-write safety) and the directory left intact.
    const target = path.join(root, "occupied");
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "keep.txt"), "keep");

    await expect(adapter.writeFileAtomic(target, "clobber")).rejects.toThrow();

    // No leftover `.occupied.*.tmp` in the root, and the directory still stands.
    const stray = (await fs.readdir(root)).filter((name) => name.startsWith(".occupied"));
    expect(stray).toEqual([]);
    expect(await fs.readFile(path.join(target, "keep.txt"), "utf8")).toBe("keep");
  });

  it("returns null for a missing file and [] for a missing directory", async () => {
    const adapter = new FsStorageAdapter({ storageDir: root });
    expect(await adapter.readFile(path.join(root, "nope.json"))).toBeNull();
    expect(await adapter.readdir(path.join(root, "nope"))).toEqual([]);
  });

  it("rm does not throw on a missing target and removes recursively", async () => {
    const adapter = new FsStorageAdapter({ storageDir: root });
    await expect(adapter.rm(path.join(root, "ghost"))).resolves.toBeUndefined();
    const dir = path.join(root, "dir");
    await adapter.mkdir(dir);
    await adapter.writeFileAtomic(path.join(dir, "a.json"), "a");
    await adapter.rm(dir);
    expect(await adapter.readdir(dir)).toEqual([]);
  });

  it("applies the file mode on write", async () => {
    const adapter = new FsStorageAdapter({ storageDir: root });
    const target = path.join(root, "secret.json");
    await adapter.writeFileAtomic(target, "s", { mode: 0o600 });
    const stat = await fs.stat(target);
    expect(stat.mode & 0o777).toBe(0o600);
  });
});
