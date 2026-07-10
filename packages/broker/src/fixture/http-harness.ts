// Run the fake MCP server in-process over Streamable HTTP on an ephemeral loopback port
// (no external network — CI-safe). Returns the URL to point an http connector at, the
// shared catalog `state` (flip `.mutated` to drive rug-pull tests), and a `close`.
//
// Stateless mode per the SDK's own example (examples/server/simpleStatelessStreamableHttp):
// each POST gets a FRESH server + transport built over the SHARED `state`, so a mutated
// catalog is observed on the next request; GET/DELETE answer 405 (no server-push stream).

import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildFakeMcpServer, type FakeCatalogState } from "./fake-mcp-server.js";

export type HttpFakeServer = {
  /** The MCP endpoint to hand an http connector (`http://127.0.0.1:<port>/mcp`). */
  url: string;
  /** Shared catalog state — flip `.mutated` between `listTools()` calls for rug-pull tests. */
  state: FakeCatalogState;
  close: () => Promise<void>;
};

const METHOD_NOT_ALLOWED = JSON.stringify({
  jsonrpc: "2.0",
  error: { code: -32000, message: "Method not allowed." },
  id: null,
});

/** Start the fake server over Streamable HTTP (stateless JSON mode) on 127.0.0.1. */
export async function startHttpFakeServer(
  initial: FakeCatalogState = { mutated: false },
): Promise<HttpFakeServer> {
  const state = initial;

  const http: HttpServer = createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end(METHOD_NOT_ALLOWED);
      return;
    }
    // Fresh server + transport per request, over the shared catalog state.
    const mcp = buildFakeMcpServer(state);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close().catch(() => {});
      void mcp.close().catch(() => {});
    });
    void mcp
      .connect(transport)
      .then(() => transport.handleRequest(req, res))
      .catch(() => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end();
        }
      });
  });

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const { port } = http.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    state,
    close: async () => {
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
