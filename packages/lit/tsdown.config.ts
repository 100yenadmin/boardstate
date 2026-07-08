import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/locales/*.ts"],
  dts: true,
  format: "esm",
  fixedExtension: false,
});
