// Public surface of @boardstate/mcp: an MCP stdio server that gives any MCP client the
// full Boardstate agent tool set over a local store, plus the optional `--serve` demo
// host. Consumers embed via `createBoardstateMcpServer`; the `boardstate-mcp` bin
// (`cli.ts`) is the ready-to-run entry point.

export {
  createBoardstateMcpServer,
  SERVER_NAME,
  SERVER_VERSION,
  WORKSPACE_RESOURCE_URI,
  APPROVE_TOOL_NAME,
  type BoardstateMcpServer,
  type CreateBoardstateMcpServerOptions,
} from "./mcp-server.js";
export { parseCliArgs, USAGE, type CliOptions } from "./cli-args.js";
export { startServeHost, type ServeHostOptions, type ServeHostHandle } from "./serve-host.js";
