// Honesty test for the shipped `templates/` folder: every workspace-document
// template must pass the same §3 write-time validation as any other write path,
// and the widget-gallery registry must stay a faithful, in-sync build of the
// starter widgets under `templates/widgets/`. This is what stops a hand-edited
// template or a stale `pnpm build:registry` from shipping broken.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateWorkspaceDoc } from "@boardstate/schema";
import { describe, expect, it } from "vitest";
import { parseGalleryIndex, parseWidgetBundle } from "./gallery.js";
import { validateWidgetManifest } from "./manifest.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const TEMPLATES_DIR = join(REPO_ROOT, "templates");
const WIDGETS_DIR = join(TEMPLATES_DIR, "widgets");
const REGISTRY_DIR = join(TEMPLATES_DIR, "registry");

/** The top-level `*.json` files in `templates/` are full workspace documents. */
const workspaceTemplates = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".json"));

/** The starter widget source folders under `templates/widgets/`. */
const widgetNames = readdirSync(WIDGETS_DIR).filter((name) =>
  statSync(join(WIDGETS_DIR, name)).isDirectory(),
);

describe("templates/ workspace documents", () => {
  it("ships at least the known workspace templates", () => {
    expect(workspaceTemplates).toEqual(
      expect.arrayContaining([
        "agent-hq.json",
        "focus.json",
        "maintainer.json",
        "showcase.json",
        "smallbiz.json",
      ]),
    );
  });

  it.each(workspaceTemplates)("%s passes write-time schema validation", (file) => {
    const doc = JSON.parse(readFileSync(join(TEMPLATES_DIR, file), "utf8"));
    expect(() => validateWorkspaceDoc(doc)).not.toThrow();
  });
});

describe("templates/registry widget gallery", () => {
  const index = readFileSync(join(REGISTRY_DIR, "index.json"), "utf8");
  const entries = parseGalleryIndex(index, "https://example.com/registry/index.json");

  it("lists exactly the widgets under templates/widgets/ (registry is in sync)", () => {
    const listed = entries.map((e) => e.name).sort();
    expect(listed).toEqual([...widgetNames].sort());
  });

  it.each(widgetNames)("%s bundle parses and its manifest validates", (name) => {
    const bundle = parseWidgetBundle(
      readFileSync(join(REGISTRY_DIR, `${name}.bundle.json`), "utf8"),
    );
    expect(bundle.name).toBe(name);
    // The manifest must pass authoritative (server-side) validation, and the
    // declared entrypoint must actually be one of the bundled files.
    const manifest = validateWidgetManifest(bundle.manifest, name);
    expect(bundle.files[manifest.entrypoint]).toBeTypeOf("string");
  });
});
