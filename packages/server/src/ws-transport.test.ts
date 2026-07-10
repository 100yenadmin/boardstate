// Server-half coverage for the WS endpoint: the handshake gates and lifecycle the
// networked conformance run (@boardstate/conformance) does not exercise — path
// ownership, the `verifyClient` auth hook, live connection accounting, and that it
// composes with (never steals upgrades from) the rest of an HTTP server.

import { createConnection } from "node:net";
import { createHash } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { DashboardStore, MemoryStorageAdapter, createWsTransport } from "@boardstate/core";
import { createInProcessHost, nodeRpcDeps, registerBoardstateRpc } from "./node.js";
import { attachWsTransport, type WsTransportHandle } from "./ws-transport.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Open a raw TCP socket, complete the WS handshake by hand, and hand back the live
 * socket — so a test can send bytes a compliant client never would (an unmasked frame,
 * an over-cap length header). Resolves once the 101 response is seen.
 */
function rawHandshake(port: number, path = "/ws"): Promise<import("node:net").Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      const key = createHash("sha1").update("test-key").digest("base64");
      socket.write(
        `GET ${path} HTTP/1.1\r\n` +
          "Host: 127.0.0.1\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Key: ${key}\r\n` +
          "Sec-WebSocket-Version: 13\r\n\r\n",
      );
    });
    let handshakeSeen = false;
    socket.on("data", (chunk) => {
      if (!handshakeSeen && chunk.toString("latin1").includes("101")) {
        handshakeSeen = true;
        resolve(socket);
      }
    });
    socket.on("error", reject);
  });
}

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

  it("closes on an unmasked client frame (RFC 6455 §5.1)", async () => {
    const { handle } = await startHost();
    const port = (httpServer!.address() as { port: number }).port;
    const socket = await rawHandshake(port);
    await sleep(20);
    expect(handle.connections).toBe(1);
    // A text frame with FIN set, opcode 1, length 1, and the MASK bit CLEAR — a
    // compliant client always masks; the server must refuse this.
    socket.write(Buffer.from([0x81, 0x01, 0x41])); // unmasked "A"
    await sleep(40);
    expect(handle.connections).toBe(0);
    socket.destroy();
  });

  it("closes on a frame that declares a payload past the message cap (no unbounded buffering)", async () => {
    const { handle } = await startHost();
    const port = (httpServer!.address() as { port: number }).port;
    const socket = await rawHandshake(port);
    await sleep(20);
    expect(handle.connections).toBe(1);
    // Masked text frame, 64-bit length = 2 GiB, and only a mask + a few bytes sent.
    // The server must refuse on the DECLARED length, not buffer toward 2 GiB.
    const header = Buffer.alloc(10);
    header[0] = 0x81; // FIN + text
    header[1] = 0xff; // MASK set + 127 (64-bit length follows)
    header.writeUInt32BE(0, 2); // high word
    header.writeUInt32BE(0x80000000, 6); // low word = 2 GiB
    socket.write(Buffer.concat([header, Buffer.from([0, 0, 0, 0]), Buffer.from([0x41])]));
    await sleep(40);
    expect(handle.connections).toBe(0);
    socket.destroy();
  });
});
