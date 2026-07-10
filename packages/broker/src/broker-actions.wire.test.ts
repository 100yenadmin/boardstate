// The M5 trust layer end-to-end over the REAL McpBroker + the fake-MCP fixture, driven
// across a REAL WebSocket pair (SPEC §17.1 tool grants + §18 pending actions). This is
// the wire-contract proof for the pending-action engine: a NETWORKED client can PARK a
// side-effecting call but can NEVER confirm it (operator-only), a readOnly granted tool
// executes directly, and a live manifest rug-pull re-pends the grant before any call
// succeeds. The engine (`installBrokerActions`) lives in @boardstate/server and consumes
// the broker through the narrow `ActionBroker` interface — the real `McpBroker` fits it
// structurally (`hashToolSubset` and all).

import { createServer, type Server as HttpServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { DashboardStore, MemoryStorageAdapter, createWsTransport } from "@boardstate/core";
import {
  attachWsTransport,
  createInProcessHost,
  installBrokerActions,
  nodeRpcDeps,
  registerBoardstateRpc,
  type BrokerActionsHandle,
  type InProcessHost,
} from "@boardstate/server/node";
import { McpBroker } from "./broker.js";
import { parseConnectorsConfig } from "./config.js";
import { startHttpFakeServer, type HttpFakeServer } from "./fixture/http-harness.js";

type Rig = {
  host: InProcessHost;
  store: DashboardStore;
  handle: BrokerActionsHandle;
  broker: McpBroker;
  fake: HttpFakeServer;
  http: HttpServer;
  wsUrl: string;
  close: () => Promise<void>;
};

async function makeRig(): Promise<Rig> {
  const fake = await startHttpFakeServer();
  const broker = new McpBroker(
    parseConnectorsConfig({ connectors: [{ name: "fake", transport: "http", url: fake.url }] }),
  );
  const storage = new MemoryStorageAdapter();
  const store = new DashboardStore({ storage });
  const host = createInProcessHost(store, storage);
  const handle = installBrokerActions(host, { broker, store });
  registerBoardstateRpc(host, {
    store,
    ...nodeRpcDeps(),
    capabilityToolsHash: handle.capabilityToolsHash,
  });
  await handle.ready;
  const http = createServer();
  // Default endpoint: a NON-operator networked client (no allowOperatorMethods).
  attachWsTransport(http, host);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as { port: number }).port;
  return {
    host,
    store,
    handle,
    broker,
    fake,
    http,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    async close() {
      handle.stop();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      await broker.close();
      await fake.close();
    },
  };
}

let rig: Rig | null = null;
afterEach(async () => {
  await rig?.close();
  rig = null;
});

/** Grant the full requested tool set for a connector (operator = in-process host). */
async function grantAll(host: InProcessHost, name: string): Promise<void> {
  await host.request("dashboard.capability.approve", { name, decision: "granted", actor: "user" });
}

describe("grant registration over the real broker", () => {
  it("lands a tools-only `requested` grant snapshotting the fixture's tool ids", async () => {
    rig = await makeRig();
    const grant = (await rig.store.read()).capabilitiesRegistry!.fake!;
    expect(grant.status).toBe("requested");
    expect(grant.methods).toEqual([]);
    expect(grant.streams).toEqual([]);
    expect(grant.tools).toEqual(
      ["fake:add", "fake:boom", "fake:echo", "fake:sleep", "fake:write_note"].sort(),
    );
    expect(grant.toolsHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("pending-action engine over a REAL WS pair (SPEC §18)", () => {
  it("non-operator invoke of a mutation parks; confirm is operator-only; operator confirm executes once", async () => {
    rig = await makeRig();
    await grantAll(rig.host, "fake");

    const client = createWsTransport(rig.wsUrl);
    await client.ready;

    // A networked client MAY invoke — a mutation only PARKS (never executes here).
    const parked = (await client.request("dashboard.action.invoke", {
      connector: "fake",
      tool: "write_note",
      args: { text: "hello" },
    })) as { pending: boolean; id: string; expiresAt: string };
    expect(parked.pending).toBe(true);
    expect(rig.handle.pendingActions()).toHaveLength(1);

    // The networked client can NOT confirm — operator-only, refused before the host.
    await expect(client.request("dashboard.action.confirm", { id: parked.id })).rejects.toThrow(
      /operator-only|operator_only/,
    );
    expect(rig.handle.pendingActions()).toHaveLength(1); // still parked

    // The OPERATOR (in-process) confirms → executes exactly once.
    const confirmed = (await rig.host.request("dashboard.action.confirm", {
      id: parked.id,
      actor: "user",
    })) as { id: string; result: { content: unknown } };
    expect(confirmed.result.content).toBeDefined();
    expect(rig.handle.pendingActions()).toHaveLength(0);

    // Replay of the terminal id errors — single-shot.
    await expect(rig.host.request("dashboard.action.confirm", { id: parked.id })).rejects.toThrow();

    client.close();
  });

  it("a granted readOnly tool executes directly over the wire (no confirm)", async () => {
    rig = await makeRig();
    await grantAll(rig.host, "fake");
    const client = createWsTransport(rig.wsUrl);
    await client.ready;
    const res = (await client.request("dashboard.action.invoke", {
      connector: "fake",
      tool: "echo",
      args: { text: "ping" },
    })) as { content: Array<{ text: string }> };
    expect(res.content[0]!.text).toContain("ping");
    expect(rig.handle.pendingActions()).toHaveLength(0);
    client.close();
  });

  it("deny is terminal and the tool never executes", async () => {
    rig = await makeRig();
    await grantAll(rig.host, "fake");
    const parked = (await rig.host.request("dashboard.action.invoke", {
      connector: "fake",
      tool: "write_note",
      args: { text: "x" },
    })) as { id: string };
    await rig.host.request("dashboard.action.deny", { id: parked.id, actor: "user" });
    await expect(rig.host.request("dashboard.action.confirm", { id: parked.id })).rejects.toThrow();
  });
});

describe("anti-rug-pull over the real broker (SPEC §17.1)", () => {
  it("re-pends the grant when the connector mutates a granted tool's manifest", async () => {
    rig = await makeRig();
    await grantAll(rig.host, "fake");

    // Confirm the readOnly path works BEFORE the rug-pull.
    const before = await rig.host.request("dashboard.action.invoke", {
      connector: "fake",
      tool: "add",
      args: { a: 2, b: 3 },
    });
    expect(before).toBeDefined();

    // The fixture flips its catalog (add gains a `c` operand — schema + hash move).
    rig.fake.state.mutated = true;

    // The next call sees the manifest drift and re-pends BEFORE any call succeeds.
    await expect(
      rig.host.request("dashboard.action.invoke", {
        connector: "fake",
        tool: "add",
        args: { a: 2, b: 3 },
      }),
    ).rejects.toThrow(/manifest changed|capability/i);
    expect((await rig.store.read()).capabilitiesRegistry!.fake!.status).toBe("requested");
  });
});

describe("partial grant over the real broker (SPEC §17.1)", () => {
  it("grants a subset with its own hash; a tool outside the subset is ungranted", async () => {
    rig = await makeRig();
    // Approve only the readOnly `echo` tool.
    await rig.host.request("dashboard.capability.approve", {
      name: "fake",
      decision: "granted",
      actor: "user",
      tools: ["fake:echo"],
    });
    const grant = (await rig.store.read()).capabilitiesRegistry!.fake!;
    expect(grant.tools).toEqual(["fake:echo"]);
    expect(grant.toolsHash).toMatch(/^[0-9a-f]{64}$/);

    // The granted tool works...
    const client = createWsTransport(rig.wsUrl);
    await client.ready;
    await expect(
      client.request("dashboard.action.invoke", {
        connector: "fake",
        tool: "echo",
        args: { text: "y" },
      }),
    ).resolves.toBeDefined();
    // ...but an ungranted sibling is refused.
    await expect(
      client.request("dashboard.action.invoke", {
        connector: "fake",
        tool: "add",
        args: { a: 1, b: 1 },
      }),
    ).rejects.toThrow(/granted|capability/i);
    client.close();
  });
});
