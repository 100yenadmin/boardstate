import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DashboardStore, FsStorageAdapter, resolveWidgetDir } from "@boardstate/core";
import { describe, expect, it } from "vitest";
import { installWidgetBundle, WIDGET_BUNDLE_MAX_BYTES } from "./install.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function withTempStateDir<T>(run: (stateDir: string) => Promise<T>): Promise<T> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "boardstate-install-"));
  try {
    return await run(stateDir);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
}

function storeAt(stateDir: string): DashboardStore {
  return new DashboardStore({ storage: new FsStorageAdapter({ storageDir: stateDir }) });
}

function validManifest(name = "weather") {
  return {
    schemaVersion: 1,
    name,
    title: "Weather",
    entrypoint: "index.html",
    bindings: [],
    capabilities: ["data:read"],
  };
}

function validFiles() {
  return { "index.html": "<!doctype html><title>Weather</title>" };
}

describe("installWidgetBundle", () => {
  it("writes a pending registry entry and the widget files (never approved)", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      const { doc } = await installWidgetBundle(
        store,
        { name: "weather", manifest: validManifest(), files: validFiles() },
        { actor: "user", stateDir },
      );
      // Registry entry is pending — the approval gate stands.
      expect(doc.widgetsRegistry.weather).toEqual({ status: "pending", createdBy: "user" });
      expect(doc.widgetsRegistry.weather?.status).not.toBe("approved");
      // Files landed under the widget's own dir, including a canonical widget.json.
      const widgetDir = resolveWidgetDir("weather", stateDir);
      const manifestOnDisk = JSON.parse(
        await fs.readFile(path.join(widgetDir, "widget.json"), "utf8"),
      );
      expect(manifestOnDisk.name).toBe("weather");
      expect(await fs.readFile(path.join(widgetDir, "index.html"), "utf8")).toContain("Weather");
    });
  });

  it("rejects an oversize bundle before writing anything", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      const huge = "x".repeat(WIDGET_BUNDLE_MAX_BYTES + 1);
      await expect(
        installWidgetBundle(
          store,
          { name: "weather", manifest: validManifest(), files: { "index.html": huge } },
          { actor: "user", stateDir },
        ),
      ).rejects.toThrow(/exceeds 512 KB/);
      expect((await store.read()).widgetsRegistry.weather).toBeUndefined();
      await expect(fs.stat(resolveWidgetDir("weather", stateDir))).rejects.toBeDefined();
    });
  });

  it("rejects an invalid manifest", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      await expect(
        installWidgetBundle(
          store,
          { name: "weather", manifest: { schemaVersion: 2 }, files: validFiles() },
          { actor: "user", stateDir },
        ),
      ).rejects.toThrow(/schemaVersion must be 1/);
      expect((await store.read()).widgetsRegistry.weather).toBeUndefined();
    });
  });

  it("rejects a manifest whose name does not match the install name", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      await expect(
        installWidgetBundle(
          store,
          { name: "weather", manifest: validManifest("other"), files: validFiles() },
          { actor: "user", stateDir },
        ),
      ).rejects.toThrow(/name does not match/);
    });
  });

  it("rejects a bundle missing its entrypoint file", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      await expect(
        installWidgetBundle(
          store,
          { name: "weather", manifest: validManifest(), files: { "other.html": "<p>hi</p>" } },
          { actor: "user", stateDir },
        ),
      ).rejects.toThrow(/missing its entrypoint/);
    });
  });

  it("rejects a disallowed file type and a traversal path", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      await expect(
        installWidgetBundle(
          store,
          {
            name: "weather",
            manifest: validManifest(),
            files: { "index.html": "<p>x</p>", "evil.mjs": "0" },
          },
          { actor: "user", stateDir },
        ),
      ).rejects.toThrow(/not allowed/);
      await expect(
        installWidgetBundle(
          store,
          {
            name: "weather",
            manifest: validManifest(),
            files: { "index.html": "<p>x</p>", "../escape.html": "0" },
          },
          { actor: "user", stateDir },
        ),
      ).rejects.toThrow(/path is invalid/);
    });
  });

  it("refuses to overwrite an existing widget", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      await installWidgetBundle(
        store,
        { name: "weather", manifest: validManifest(), files: validFiles() },
        { actor: "user", stateDir },
      );
      await expect(
        installWidgetBundle(
          store,
          { name: "weather", manifest: validManifest(), files: validFiles() },
          { actor: "user", stateDir },
        ),
      ).rejects.toThrow(/already exists/);
    });
  });
});

describe("install has no server-side network egress (SSRF guard)", () => {
  it("neither install.ts nor the control-plane install path fetches a URL", async () => {
    const installSrc = await fs.readFile(path.join(HERE, "install.ts"), "utf8");
    const rpcSrc = await fs.readFile(path.join(HERE, "rpc.ts"), "utf8");
    for (const src of [installSrc, rpcSrc]) {
      expect(src).not.toMatch(/\bfetch\s*\(/);
      expect(src).not.toMatch(/node:https?/);
      expect(src).not.toMatch(/\b(undici|axios|node-fetch|XMLHttpRequest)\b/);
    }
  });
});
