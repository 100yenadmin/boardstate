import { defineConfig } from "tsdown";

export default defineConfig({
  // The public API plus the runnable fake-server stdio entry (the `boardstate-fake-mcp`
  // bin, and the child the broker's stdio wire-contract test spawns).
  entry: ["src/index.ts", "src/fixture/stdio-entry.ts"],
  dts: true,
  format: "esm",
  fixedExtension: false,
});
