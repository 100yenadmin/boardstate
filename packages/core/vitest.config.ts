import { defineConfig } from "vitest/config";

// Package-local config so `pnpm --filter @boardstate/core test` (cwd = this
// package) runs only this package's suite. The root vitest.config.ts still
// aggregates every package under its `core` project for the workspace run.
export default defineConfig({
  test: {
    name: "core",
    environment: "node",
  },
});
