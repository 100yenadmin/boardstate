import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  // The hosted app deploys to GitHub Pages under /boardstate/app/ — the workflow
  // sets BASE_PATH; local dev stays at "/".
  base: process.env.BASE_PATH ?? "/",
  server: {
    port: 5179,
    strictPort: true,
    // Allow importing the shared templates/ dir at the repo root.
    fs: { allow: ["../.."] },
  },
  build: { outDir: "dist", target: "es2022" },
});
