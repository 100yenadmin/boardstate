import { afterEach, describe, expect, it, vi } from "vitest";
import type { Transport } from "@boardstate/core";
import {
  GALLERY_BUNDLE_MAX_BYTES,
  fetchGalleryIndex,
  fetchWidgetBundle,
  installGalleryWidget,
} from "./gallery.js";

function mockFetchOnce(body: string, ok = true, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status,
      text: async () => body,
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const bundleJson = JSON.stringify({
  manifest: {
    schemaVersion: 1,
    name: "weather",
    title: "Weather",
    entrypoint: "index.html",
    bindings: [{ id: "b1", source: "rpc", method: "sessions.list" }],
    capabilities: ["data:read"],
  },
  files: { "index.html": "<title>Weather</title>" },
});

describe("fetchGalleryIndex", () => {
  it("fetches + parses a bare array and resolves relative manifest URLs", async () => {
    mockFetchOnce(
      JSON.stringify([
        { name: "weather", description: "Weather now", manifestUrl: "./weather.json" },
        { name: "bad name!" }, // dropped (invalid name, no url)
      ]),
    );
    const entries = await fetchGalleryIndex("https://reg.example.com/widgets/index.json");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      name: "weather",
      description: "Weather now",
      manifestUrl: "https://reg.example.com/widgets/weather.json",
    });
  });

  it("accepts a { widgets: [...] } wrapper", async () => {
    mockFetchOnce(
      JSON.stringify({ widgets: [{ name: "w", manifestUrl: "https://x.example.com/w.json" }] }),
    );
    const entries = await fetchGalleryIndex("https://reg.example.com/index.json");
    expect(entries[0]!.name).toBe("w");
  });

  it("rejects a non-list index", async () => {
    mockFetchOnce(JSON.stringify({ nope: true }));
    await expect(fetchGalleryIndex("https://reg.example.com/index.json")).rejects.toThrow(
      /must be a list/,
    );
  });
});

describe("fetchWidgetBundle", () => {
  it("fetches, shape-checks, and surfaces the requested capabilities", async () => {
    mockFetchOnce(bundleJson);
    const bundle = await fetchWidgetBundle("https://reg.example.com/weather.json");
    expect(bundle.name).toBe("weather");
    expect(bundle.title).toBe("Weather");
    expect(bundle.capabilities).toEqual(["data:read"]);
    expect(bundle.bindingIds).toEqual(["b1"]);
    expect(bundle.files["index.html"]).toContain("Weather");
  });

  it("rejects an oversize bundle at the client cap (fetch layer, before parse)", async () => {
    const huge = JSON.stringify({
      manifest: { name: "weather" },
      files: { "index.html": "x".repeat(GALLERY_BUNDLE_MAX_BYTES + 10) },
    });
    mockFetchOnce(huge);
    await expect(fetchWidgetBundle("https://reg.example.com/weather.json")).rejects.toThrow(
      /too large/,
    );
  });

  it("rejects a bundle without manifest/files", async () => {
    mockFetchOnce(JSON.stringify({ manifest: { name: "weather" } }));
    await expect(fetchWidgetBundle("https://reg.example.com/weather.json")).rejects.toThrow(
      /`manifest` and `files`/,
    );
  });
});

describe("installGalleryWidget", () => {
  it("installs via dashboard.widget.install with the fetched bytes and never approves", async () => {
    const request = vi.fn(async (_method: string) => ({}));
    const transport = { request, addEventListener: vi.fn(() => () => {}) } as unknown as Transport;
    const bundle = {
      name: "weather",
      title: "Weather",
      capabilities: ["data:read" as const],
      bindingIds: [],
      manifest: { schemaVersion: 1, name: "weather" },
      files: { "index.html": "<title>Weather</title>" },
    };
    await installGalleryWidget(transport, bundle);
    expect(request).toHaveBeenCalledWith("dashboard.widget.install", {
      name: "weather",
      manifest: bundle.manifest,
      files: bundle.files,
    });
    // Install NEVER auto-approves.
    expect(request.mock.calls.some((call) => call[0] === "dashboard.widget.approve")).toBe(false);
  });

  it("throws when disconnected", async () => {
    await expect(
      installGalleryWidget(null, {
        name: "w",
        title: "W",
        capabilities: [],
        bindingIds: [],
        manifest: { name: "w" },
        files: {},
      }),
    ).rejects.toThrow(/connected/i);
  });
});
