import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/node.ts"],
  dts: true,
  format: "esm",
  platform: "node",
  fixedExtension: false,
});
