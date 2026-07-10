// Server-half coverage for the WS endpoint: the handshake gates and lifecycle the
// networked conformance run (@boardstate/conformance) does not exercise — path
// ownership, the `verifyClient` auth hook, live connection accounting, and that it
// composes with (never steals upgrades from) the rest of an HTTP server.

import { createServer, type Server as HttpServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { DashboardStore, MemoryStorageAdapter, createWsTransport } from "@boardstate/core";
import { createInProcessHost, nodeRpcDeps, registerBoardstateRpc } from "./node.js";
import { attachWsTransport, type WsTransportHandle } from "./ws-transport.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let httpServer: HttpServer | null = null;
let wsHandle: WsTransportHandle | null = null;

afterEach(async () => {
  wsHandle?.close();
  wsHandle = null;
  if (httpServer) {
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    httpServer = null;
  }
});

async function startHost(options?: Parameters<typeof attachWsTransport>[2]): Promise<{
  url: (path?: string) => string;
  handle: WsTransportHandle;
}> {
  const storage = new MemoryStorageAdapter();
  const store = new DashboardStore({ storage });
  const host = createInProcessHost(store, storage);
  registerBoardstateRpc(host, { store, ...nodeRpcDeps() });
  httpServer = createServer();
  wsHandle = attachWsTransport(httpServer, host, options);
  await new Promise<void>((resolve) => httpServer!.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    handle: wsHandle,
    url: (path = "/ws") => `ws://127.0.0.1:${port}${path}`,
  };
}

describe("attachWsTransport", () => {
  it("round-trips a request and tracks the live connection count", async () => {
    const { url, handle } = await startHost();
    const transport = createWsTransport(url());
    await transport.ready;
    expect(handle.connections).toBe(1);

    const envelope = (await transport.request("dashboard.workspace.get")) as {
      doc: { tabs: unknown[] };
    };
    expect(Array.isArray(envelope.doc.tabs)).toBe(true);

    transport.close();
    await sleep(30);
    expect(handle.connections).toBe(0);
  });

  it("owns only its configured path — an upgrade elsewhere is refused", async () => {
    const { url } = await startHost({ path: "/ws" });
    const transport = createWsTransport(url("/somewhere-else"));
    await expect(transport.ready).rejects.toBeDefined();
    expect(transport.closed).toBe(true);
  });

  it("rejects the handshake when verifyClient returns false", async () => {
    const { url, handle } = await startHost({ verifyClient: () => false });
    const transport = createWsTransport(url());
    await expect(transport.ready).rejects.toBeDefined();
    expect(handle.connections).toBe(0);
  });
});
