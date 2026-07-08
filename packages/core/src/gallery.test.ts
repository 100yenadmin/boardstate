import { describe, expect, it } from "vitest";
import { parseGalleryIndex, parseWidgetBundle } from "./gallery.js";

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

describe("parseGalleryIndex", () => {
  it("parses a bare array and resolves relative manifest URLs, dropping malformed entries", () => {
    const entries = parseGalleryIndex(
      JSON.stringify([
        { name: "weather", description: "Weather now", manifestUrl: "./weather.json" },
        { name: "bad name!" }, // dropped (invalid name, no url)
      ]),
      "https://reg.example.com/widgets/index.json",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      name: "weather",
      description: "Weather now",
      manifestUrl: "https://reg.example.com/widgets/weather.json",
    });
  });

  it("accepts a { widgets: [...] } wrapper", () => {
    const entries = parseGalleryIndex(
      JSON.stringify({ widgets: [{ name: "w", manifestUrl: "https://x.example.com/w.json" }] }),
      "https://reg.example.com/index.json",
    );
    expect(entries[0]!.name).toBe("w");
  });

  it("rejects a non-list index", () => {
    expect(() =>
      parseGalleryIndex(JSON.stringify({ nope: true }), "https://reg.example.com"),
    ).toThrow(/must be a list/);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseGalleryIndex("{not json", "https://reg.example.com")).toThrow(/valid JSON/);
  });
});

describe("parseWidgetBundle", () => {
  it("shape-checks and surfaces the requested capabilities + binding ids", () => {
    const bundle = parseWidgetBundle(bundleJson);
    expect(bundle.name).toBe("weather");
    expect(bundle.title).toBe("Weather");
    expect(bundle.capabilities).toEqual(["data:read"]);
    expect(bundle.bindingIds).toEqual(["b1"]);
    expect(bundle.files["index.html"]).toContain("Weather");
  });

  it("rejects a bundle without manifest/files", () => {
    expect(() => parseWidgetBundle(JSON.stringify({ manifest: { name: "weather" } }))).toThrow(
      /`manifest` and `files`/,
    );
  });

  it("rejects a manifest with an invalid name", () => {
    expect(() =>
      parseWidgetBundle(JSON.stringify({ manifest: { name: "bad name!" }, files: {} })),
    ).toThrow(/invalid name/);
  });

  it("rejects a non-text bundle file", () => {
    expect(() =>
      parseWidgetBundle(
        JSON.stringify({ manifest: { name: "weather" }, files: { "index.html": 5 } }),
      ),
    ).toThrow(/must be text/);
  });
});
