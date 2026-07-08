import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "host", environment: "happy-dom" },
});
