import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/index.ts", "src/cli.ts"],
    dts: true,
    format: "esm",
    platform: "node",
    fixedExtension: false,
  },
  // The in-iframe MCP Apps client (`ui://boardstate/board.html`): everything inlined
  // (ext-apps bridge + the lit browser bundle) because the host CSP is deny-by-default
  // for network — the resource must be self-contained. Embedded by src/apps.ts.
  {
    entry: { "board-app-client": "src/board-app-client.ts" },
    dts: false,
    format: "iife",
    platform: "browser",
    fixedExtension: false,
    noExternal: [/.*/],
  },
]);
