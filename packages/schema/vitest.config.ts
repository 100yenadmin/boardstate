import { defineConfig } from "vitest/config";

// Package-local config so `pnpm --filter @boardstate/schema test` (cwd = this
// package) runs only this package's suite. The root vitest.config.ts still
// aggregates every package under its `schema` project for the workspace run.
export default defineConfig({
  test: {
    name: "schema",
    environment: "node",
  },
});
