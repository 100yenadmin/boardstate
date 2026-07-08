import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "react", environment: "happy-dom" },
});
