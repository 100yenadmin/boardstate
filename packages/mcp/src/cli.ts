#!/usr/bin/env node
// The `boardstate-mcp` CLI: parse flags, start the MCP server over stdio, and
// optionally start the `--serve <port>` demo host page (dynamically imported so the
// stdio server has no HTTP dependency unless asked for). Shuts down cleanly on
// SIGINT/SIGTERM.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseCliArgs, USAGE, type CliOptions } from "./cli-args.js";
import { createBoardstateMcpServer } from "./mcp-server.js";

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(`\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const { server, store, host } = createBoardstateMcpServer(
    options.stateDir ? { stateDir: options.stateDir } : {},
  );

  let closeServeHost: (() => Promise<void>) | undefined;
  if (options.servePort !== undefined) {
    // Dynamically imported so the stdio server carries no HTTP surface unless asked.
    const { startServeHost } = await import("./serve-host.js");
    const handle = await startServeHost({ store, host, port: options.servePort });
    closeServeHost = handle.close;
    console.error(`[boardstate-mcp] host page live at ${handle.url}`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[boardstate-mcp] serving over stdio (state dir: ${store.stateDir})`);

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (closeServeHost) {
      await closeServeHost().catch(() => {});
    }
    await server.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main();
