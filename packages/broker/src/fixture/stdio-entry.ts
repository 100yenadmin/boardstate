#!/usr/bin/env node
// Runnable stdio entry for the fake MCP server — the `command` a stdio connector spawns
// in the broker's wire-contract test (and a handy manual `boardstate-fake-mcp` bin).
// `FAKE_MCP_MUTATED=1` seeds the mutated catalog so a stdio child can serve the
// post-rug-pull tool set. No network; speaks MCP over stdin/stdout only.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildFakeMcpServer } from "./fake-mcp-server.js";

async function main(): Promise<void> {
  const server = buildFakeMcpServer({ mutated: process.env.FAKE_MCP_MUTATED === "1" });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  // stderr only — stdout is the MCP wire and must not be polluted.
  process.stderr.write(`fake-mcp failed to start: ${(error as Error).message}\n`);
  process.exit(1);
});
