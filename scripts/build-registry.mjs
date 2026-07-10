// Build the widget-gallery registry from the starter widgets, and sync the
// standalone example's static copies.
//
//   node scripts/build-registry.mjs      (or: pnpm build:registry)
//
// Inputs:  templates/widgets/<name>/{widget.json,index.html,README.md,...}
// Outputs: templates/registry/index.json + templates/registry/<name>.bundle.json
//          examples/standalone/public/registry/*          (served by the demo)
//          examples/standalone/public/widgets/<name>/*    (static bundle files, so
//            the sandboxed iframe's document navigation resolves without a server)
//
// A bundle is `{ manifest, files }` (SPEC §8.2 / @boardstate/core parseWidgetBundle);
// the registry index is `{ widgets: [{ name, description, manifestUrl }] }`. Entry
// descriptions come from the first prose line of each widget's README.md — the
// manifest schema deliberately rejects unknown keys, so there is no description
// field in widget.json.

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WIDGETS_DIR = join(ROOT, "templates/widgets");
const REGISTRY_DIR = join(ROOT, "templates/registry");
const PUBLIC_DIR = join(ROOT, "examples/standalone/public");

/** First prose PARAGRAPH of a README (headings skipped, hard wraps joined). */
function readmeDescription(dir) {
  try {
    const text = readFileSync(join(dir, "README.md"), "utf8");
    const lines = text.split("\n");
    let i = 0;
    while (i < lines.length && (!lines[i].trim() || lines[i].trim().startsWith("#"))) i++;
    const para = [];
    while (i < lines.length && lines[i].trim() && !lines[i].trim().startsWith("#")) {
      para.push(lines[i].trim());
      i++;
    }
    const joined = para.join(" ").replaceAll(/[*_`]/g, "");
    if (!joined) return null;
    if (joined.length <= 180) return joined;
    // Truncate on a word boundary: cut at the last space before 177 (never mid-word).
    const head = joined.slice(0, 177);
    const lastSpace = head.lastIndexOf(" ");
    return `${(lastSpace > 0 ? head.slice(0, lastSpace) : head).trimEnd()}…`;
  } catch {
    /* no README — fall through */
  }
  return null;
}

const entries = [];
mkdirSync(REGISTRY_DIR, { recursive: true });
mkdirSync(join(PUBLIC_DIR, "registry"), { recursive: true });

for (const name of readdirSync(WIDGETS_DIR).sort()) {
  const dir = join(WIDGETS_DIR, name);
  if (!statSync(dir).isDirectory()) continue;

  const manifest = JSON.parse(readFileSync(join(dir, "widget.json"), "utf8"));
  if (manifest.name !== name) {
    throw new Error(`${name}/widget.json: manifest name "${manifest.name}" != folder name`);
  }

  const files = {};
  for (const file of readdirSync(dir).sort()) {
    if (file === "widget.json") continue;
    files[file] = readFileSync(join(dir, file), "utf8");
  }

  const bundle = `${JSON.stringify({ manifest, files }, null, 2)}\n`;
  writeFileSync(join(REGISTRY_DIR, `${name}.bundle.json`), bundle);
  writeFileSync(join(PUBLIC_DIR, "registry", `${name}.bundle.json`), bundle);

  // Static serving copies: the runtime-requested files only (manifest + assets).
  const serveDir = join(PUBLIC_DIR, "widgets", name);
  rmSync(serveDir, { recursive: true, force: true });
  mkdirSync(serveDir, { recursive: true });
  writeFileSync(join(serveDir, "widget.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [file, content] of Object.entries(files)) {
    if (file === "README.md") continue; // docs, not a served asset
    writeFileSync(join(serveDir, file), content);
  }

  entries.push({
    name,
    description: readmeDescription(dir) ?? manifest.title,
    manifestUrl: `./${name}.bundle.json`,
  });
}

// ── Template recipes (issue #60): a board + the grants it needs, as one installable ──
// Sources live in templates/recipes/<name>.recipe.json (pure data — no assembly). The
// generator verifies name===filename, copies each to the served registry, and adds a
// static-hostable `recipes[]` index entry. Full `validateRecipe` runs in the honesty
// test (packages/core templates.test.ts), which fails the build on any broken recipe.
const RECIPES_DIR = join(ROOT, "templates/recipes");
const recipeEntries = [];
let recipeNames = [];
try {
  recipeNames = readdirSync(RECIPES_DIR)
    .filter((f) => f.endsWith(".recipe.json"))
    .sort();
} catch {
  /* no recipes dir yet */
}
for (const file of recipeNames) {
  const stem = file.slice(0, -".recipe.json".length);
  const recipe = JSON.parse(readFileSync(join(RECIPES_DIR, file), "utf8"));
  if (recipe.name !== stem) {
    throw new Error(`${file}: recipe name "${recipe.name}" != filename stem "${stem}"`);
  }
  const serialized = `${JSON.stringify(recipe, null, 2)}\n`;
  writeFileSync(join(REGISTRY_DIR, file), serialized);
  writeFileSync(join(PUBLIC_DIR, "registry", file), serialized);
  recipeEntries.push({
    name: recipe.name,
    title: recipe.title,
    description: recipe.description,
    manifestUrl: `./${file}`,
    connectors: Object.keys(recipe.grantsManifest ?? {}).sort(),
  });
}

const index = `${JSON.stringify({ widgets: entries, recipes: recipeEntries }, null, 2)}\n`;
writeFileSync(join(REGISTRY_DIR, "index.json"), index);
writeFileSync(join(PUBLIC_DIR, "registry", "index.json"), index);

console.log(`registry: ${entries.map((entry) => entry.name).join(", ")}`);
console.log(`recipes: ${recipeEntries.map((entry) => entry.name).join(", ") || "(none)"}`);
