// Honesty test for the shipped `templates/` folder: every workspace-document
// template must pass the same §3 write-time validation as any other write path,
// and the widget-gallery registry must stay a faithful, in-sync build of the
// starter widgets under `templates/widgets/`. This is what stops a hand-edited
// template or a stale `pnpm build:registry` from shipping broken.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRecipe, validateWorkspaceDoc } from "@boardstate/schema";
import { describe, expect, it } from "vitest";
import { parseGalleryIndex, parseRecipeIndex, parseWidgetBundle } from "./gallery.js";
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

/** The template-recipe sources under templates/recipes/ (issue #60). */
const RECIPES_DIR = join(TEMPLATES_DIR, "recipes");
const recipeFiles = readdirSync(RECIPES_DIR).filter((f) => f.endsWith(".recipe.json"));
const recipeNames = recipeFiles.map((f) => f.slice(0, -".recipe.json".length));

describe("templates/registry template recipes (#60)", () => {
  const index = readFileSync(join(REGISTRY_DIR, "index.json"), "utf8");
  const entries = parseRecipeIndex(index, "https://example.com/registry/index.json");

  it("ships at least the known recipes", () => {
    expect(recipeNames.sort()).toEqual(
      expect.arrayContaining(["agent-memory", "ops-board", "saas-metrics"]),
    );
  });

  it("lists exactly the recipes under templates/recipes/ (registry is in sync)", () => {
    expect(entries.map((e) => e.name).sort()).toEqual([...recipeNames].sort());
  });

  it.each(recipeNames)("%s source validates and matches its published registry copy", (name) => {
    const source = JSON.parse(readFileSync(join(RECIPES_DIR, `${name}.recipe.json`), "utf8"));
    const recipe = validateRecipe(source);
    expect(recipe.name).toBe(name);
    // The published copy in templates/registry/ must be in sync with the source (a stale
    // `pnpm build:registry` fails here rather than shipping drift). The generator
    // re-serializes, so compare the parsed value, not raw bytes.
    const published = JSON.parse(readFileSync(join(REGISTRY_DIR, `${name}.recipe.json`), "utf8"));
    expect(published).toEqual(source);
  });

  it.each(recipeNames)(
    "%s index entry declares the right connectors (matches grantsManifest)",
    (name) => {
      const recipe = validateRecipe(
        JSON.parse(readFileSync(join(RECIPES_DIR, `${name}.recipe.json`), "utf8")),
      );
      const entry = entries.find((e) => e.name === name)!;
      expect(entry.connectors.sort()).toEqual(Object.keys(recipe.grantsManifest).sort());
    },
  );

  it("every recipe grant tool is referenced by an mcp binding or action widget in its doc", () => {
    for (const name of recipeNames) {
      const recipe = validateRecipe(
        JSON.parse(readFileSync(join(RECIPES_DIR, `${name}.recipe.json`), "utf8")),
      );
      // Collect every (connector, tool) the board actually uses.
      const used = new Set<string>();
      for (const tab of recipe.doc.tabs) {
        for (const widget of tab.widgets) {
          for (const binding of Object.values(widget.bindings ?? {})) {
            if (binding.source === "mcp") {
              used.add(`${binding.connector}:${binding.tool}`);
            }
          }
          const props = widget.props;
          if (
            props &&
            typeof props === "object" &&
            !Array.isArray(props) &&
            typeof (props as Record<string, unknown>).connector === "string" &&
            typeof (props as Record<string, unknown>).tool === "string"
          ) {
            used.add(
              `${(props as Record<string, string>).connector}:${(props as Record<string, string>).tool}`,
            );
          }
        }
      }
      // Every declared grant tool must actually be wired into the board (honesty: the
      // recipe never asks for a tool it does not use).
      for (const [, grant] of Object.entries(recipe.grantsManifest)) {
        for (const tool of grant.tools ?? []) {
          expect(used, `${name}: grant tool ${tool.id} is unused by the board`).toContain(tool.id);
        }
      }
    }
  });
});
