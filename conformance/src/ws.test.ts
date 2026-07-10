// The networked run: `runTransportConformance` against a REAL WebSocket pair in one
// process — the client (`createWsTransport`, @boardstate/core) driving the reference
// in-process host through the server endpoint (`attachWsTransport`,
// @boardstate/server/node) over a loopback TCP socket. This is the proof that the
// networked seam speaks the exact same protocol as the in-process one: the same suite
// that pins `createInProcessHost` (reference.test.ts) passes verbatim over the wire.
//
// Operator-scoped assertions (§11-I6) are intentionally omitted: a networked transport
// does not carry the host-side operator `ctx` (SPEC: the third `request` arg is
// in-process only), so identity can't be threaded through one WS client. Everything
// else — envelopes, mutation shapes, the single-broadcast-per-mutation event contract,
// widget-state + history extensions, and the full chat/agent-turn stream — runs live.

import { createServer, type Server as HttpServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DashboardStore,
  MemoryStorageAdapter,
  createWsTransport,
  type Transport,
  type WsTransport,
} from "@boardstate/core";
import {
  attachWsTransport,
  createChatSessions,
  createInProcessHost,
  nodeRpcDeps,
  registerBoardstateRpc,
  type ChatAgent,
  type InProcessHost,
  type WsTransportHandle,
} from "@boardstate/server/node";
import { runTransportConformance } from "./suite.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The same minimal reference agent used by the in-process run (§14 assertions). */
function makeReferenceAgent(host: InProcessHost): ChatAgent {
  return async ({ sessionKey }, ctx) => {
    const { emit, turnId, signal } = ctx;
    emit({ type: "turn-start", sessionKey, turnId });
    emit({ type: "text-start", sessionKey, turnId, id: "t1" });
    emit({ type: "text-delta", sessionKey, turnId, id: "t1", delta: "Working" });
    await sleep(5);
    if (signal.aborted) {
      return;
    }
    emit({ type: "text-delta", sessionKey, turnId, id: "t1", delta: "…" });
    emit({ type: "text-end", sessionKey, turnId, id: "t1" });

    const callId = "c1";
    emit({ type: "tool-call-start", sessionKey, turnId, callId, name: "dashboard.workspace.get" });
    emit({
      type: "tool-call-ready",
      sessionKey,
      turnId,
      callId,
      name: "dashboard.workspace.get",
      args: {},
    });
    const result = await host.request("dashboard.workspace.get", {});
    emit({ type: "tool-result", sessionKey, turnId, callId, ok: true, result });

    await sleep(5);
    if (signal.aborted) {
      return;
    }
    emit({ type: "text-start", sessionKey, turnId, id: "t2" });
    emit({ type: "text-delta", sessionKey, turnId, id: "t2", delta: "Done." });
    emit({ type: "text-end", sessionKey, turnId, id: "t2" });
    emit({ type: "turn-end", sessionKey, turnId, stopReason: "end" });
  };
}

/** A live WS pair over loopback: the host, its endpoint, and a connected client. */
type WsHarness = {
  transport: WsTransport;
  wsHandle: WsTransportHandle;
  httpServer: HttpServer;
  dataDir: string;
};

/** Stand up a fresh reference host + WS endpoint + connected client on an OS port. */
async function makeWsHarness(): Promise<WsHarness> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "boardstate-ws-"));
  const storage = new MemoryStorageAdapter();
  const store = new DashboardStore({ storage });
  const host = createInProcessHost(store, storage);
  const chat = createChatSessions({ broadcast: host.broadcast });
  registerBoardstateRpc(host, {
    store,
    dataRead: { stateDir: dataDir },
    chat,
    chatAgent: makeReferenceAgent(host),
    ...nodeRpcDeps(),
  });

  const httpServer = createServer();
  // The conformance run drives the FULL control-plane contract (incl. the operator
  // approve flow) over the wire, so it opts into operator-only methods — a real
  // networked host would gate these behind its own operator auth instead.
  const wsHandle = attachWsTransport(httpServer, host, { allowOperatorMethods: true });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const transport = createWsTransport(`ws://127.0.0.1:${port}/ws`);
  await transport.ready;
  return { transport, wsHandle, httpServer, dataDir };
}

async function teardownWsHarness(harness: WsHarness): Promise<void> {
  harness.transport.close();
  harness.wsHandle.close();
  await new Promise<void>((resolve) => harness.httpServer.close(() => resolve()));
  await fs.rm(harness.dataDir, { recursive: true, force: true });
}

runTransportConformance(
  async () => {
    const harness = await makeWsHarness();
    return {
      transport: harness.transport as Transport,
      teardown: () => teardownWsHarness(harness),
    };
  },
  { extensions: { widgetState: true, history: true }, chat: true },
);

// Reconnect safety (v1: no auto-reconnect). A dropped socket must fail every request
// cleanly — never hang, never resolve against a dead connection.
describe("ws transport reconnect safety", () => {
  const harnesses: WsHarness[] = [];
  afterAll(async () => {
    await Promise.all(harnesses.map(teardownWsHarness));
  });

  it("rejects a request issued after the client closes the socket", async () => {
    const harness = await makeWsHarness();
    harnesses.push(harness);
    harness.transport.close();
    expect(harness.transport.closed).toBe(true);
    await expect(harness.transport.request("dashboard.workspace.get")).rejects.toThrow(/closed/i);
  });

  it("rejects an in-flight and subsequent request when the server drops the connection", async () => {
    const harness = await makeWsHarness();
    harnesses.push(harness);
    // Drop the server side; the client observes the close and fails cleanly.
    harness.wsHandle.close();
    await sleep(50);
    await expect(harness.transport.request("dashboard.workspace.get")).rejects.toMatchObject({
      code: "transport_closed",
    });
  });
});
