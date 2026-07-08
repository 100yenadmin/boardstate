import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  server: {
    port: 5178,
    strictPort: true,
    // Allow importing the shared templates/ dir at the repo root.
    fs: { allow: ["../.."] },
  },
  build: { outDir: "dist", target: "es2022" },
});
