import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/index.ts", "src/locales/*.ts"],
    dts: true,
    format: "esm",
    fixedExtension: false,
  },
  // The browser-standalone bundle (`@boardstate/lit/browser`): a single self-contained
  // ESM file with lit + the `@boardstate/*` deps inlined, so a plain browser can load
  // it with no bundler/import map. See src/browser.ts for the rationale.
  {
    entry: { browser: "src/browser.ts" },
    dts: true,
    format: "esm",
    platform: "browser",
    fixedExtension: false,
    noExternal: [/^@boardstate\//, "lit", /^lit\//, /^@lit\//],
  },
]);
