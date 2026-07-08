import { defineConfig } from "vitest/config";

const domPackages = ["host", "lit", "react"];
const nodePackages = ["schema", "core", "server", "mcp"];

export default defineConfig({
  test: {
    projects: [
      ...domPackages.map((name) => ({
        test: {
          name,
          root: `./packages/${name}`,
          environment: "happy-dom",
        },
      })),
      ...nodePackages.map((name) => ({
        test: {
          name,
          root: `./packages/${name}`,
          environment: "node",
        },
      })),
      {
        test: {
          name: "conformance",
          root: "./conformance",
          environment: "node",
        },
      },
    ],
  },
});
