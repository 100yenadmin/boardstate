import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  // The hosted demo deploys to GitHub Pages under /boardstate/ — the workflow
  // sets BASE_PATH; local dev stays at "/".
  base: process.env.BASE_PATH ?? "/",
  server: {
    port: 5178,
    strictPort: true,
    // Allow importing the shared templates/ dir at the repo root.
    fs: { allow: ["../.."] },
  },
  build: { outDir: "dist", target: "es2022" },
});
