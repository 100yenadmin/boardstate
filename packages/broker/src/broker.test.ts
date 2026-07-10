// Broker behavior over an in-memory transport (fast, deterministic): config-only
// refusal, namespaced + provider-name calling, isError normalization, hard timeout,
// backoff on a flaky connect, and warm-client reconnect after a transport drop.

import { afterEach, describe, expect, it } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { McpBroker } from "./broker.js";
import { parseConnectorsConfig } from "./config.js";
import { BrokerTimeoutError, BrokerToolError, BrokerUnknownConnectorError } from "./errors.js";
import { buildFakeMcpServer, type FakeCatalogState } from "./fixture/fake-mcp-server.js";

/**
 * An in-memory transport factory wired to a fresh fake server per connect. Exposes the
 * connect count and the latest server-side transport so tests can force a drop.
 */
function inMemoryFactory(state: FakeCatalogState = { mutated: false }) {
  let connects = 0;
  let lastServerTransport: InMemoryTransport | undefined;
  const factory = (): Transport => {
    connects += 1;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    lastServerTransport = serverTransport;
    const server = buildFakeMcpServer(state);
    void server.connect(serverTransport);
    return clientTransport;
  };
  return {
    factory,
    connects: () => connects,
    dropLast: async () => {
      await lastServerTransport?.close();
      // Let the propagated onclose settle before the next call.
      await new Promise((resolve) => setTimeout(resolve, 5));
    },
  };
}

function makeBroker(state?: FakeCatalogState) {
  const wiring = inMemoryFactory(state);
  const config = parseConnectorsConfig({
    connectors: [{ name: "office", transport: "stdio", command: "unused-in-memory" }],
  });
  const broker = new McpBroker(config, {
    transportFactory: wiring.factory,
    initialBackoffMs: 1,
    maxBackoffMs: 4,
  });
  return { broker, wiring };
}

describe("McpBroker", () => {
  let open: McpBroker | null = null;
  afterEach(async () => {
    await open?.close();
    open = null;
  });

  it("refuses a connector that is not in the operator config", async () => {
    const { broker } = makeBroker();
    open = broker;
    await expect(broker.callTool("ghost:do_thing")).rejects.toBeInstanceOf(
      BrokerUnknownConnectorError,
    );
  });

  it("discovers a namespaced manifest with the fail-safe readOnly flag", async () => {
    const { broker } = makeBroker();
    open = broker;
    const manifest = await broker.listTools();
    const ids = manifest.tools.map((t) => t.id);
    expect(ids).toContain("office:echo");
    expect(ids).toContain("office:write_note");
    expect(manifest.tools.find((t) => t.id === "office:echo")?.readOnly).toBe(true);
    // write_note has no readOnlyHint → mutation.
    expect(manifest.tools.find((t) => t.id === "office:write_note")?.readOnly).toBe(false);
    expect(manifest.idToProvider.get("office:echo")).toBe("office__echo");
  });

  it("calls a tool by its manifest id and by its provider-safe name", async () => {
    const { broker } = makeBroker();
    open = broker;
    const manifest = await broker.listTools();

    const byId = await broker.callTool("office:add", { a: 2, b: 3 });
    expect(byId.content).toEqual([{ type: "text", text: JSON.stringify({ sum: 5 }) }]);

    const byProvider = await broker.callTool(
      "office__add",
      { a: 4, b: 1 },
      { providerToId: manifest.providerToId },
    );
    expect(byProvider.content).toEqual([{ type: "text", text: JSON.stringify({ sum: 5 }) }]);
  });

  it("normalizes an isError result into a BrokerToolError carrying the server text", async () => {
    const { broker } = makeBroker();
    open = broker;
    let thrown: unknown;
    try {
      await broker.callTool("office:boom");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BrokerToolError);
    expect((thrown as BrokerToolError).toolId).toBe("office:boom");
    expect((thrown as Error).message).toContain("boom");
  });

  it("enforces a hard timeout", async () => {
    const { broker } = makeBroker();
    open = broker;
    await expect(
      broker.callTool("office:sleep", { ms: 500 }, { timeout: 20 }),
    ).rejects.toBeInstanceOf(BrokerTimeoutError);
  });

  it("retries a flaky connect with backoff", async () => {
    let attempts = 0;
    const config = parseConnectorsConfig({
      connectors: [{ name: "office", transport: "stdio", command: "x" }],
    });
    // A transport whose start() rejects (a transient connect failure) for the first two
    // attempts, then a live in-memory transport — the broker must back off and retry.
    const broken = (): Transport => ({
      async start() {
        throw new Error("connect refused");
      },
      async send() {},
      async close() {},
    });
    const broker = new McpBroker(config, {
      initialBackoffMs: 1,
      maxBackoffMs: 2,
      transportFactory: () => {
        attempts += 1;
        if (attempts < 3) {
          return broken();
        }
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        void buildFakeMcpServer().connect(serverTransport);
        return clientTransport;
      },
    });
    open = broker;
    const manifest = await broker.listTools();
    expect(manifest.tools.length).toBeGreaterThan(0);
    expect(attempts).toBe(3);
  });

  it("reconnects a warm client after the transport drops", async () => {
    const { broker, wiring } = makeBroker();
    open = broker;
    await broker.callTool("office:echo", { text: "hi" });
    expect(wiring.connects()).toBe(1);

    await wiring.dropLast();
    // Next use must transparently reconnect (a second connect), not call a dead client.
    const result = await broker.callTool("office:echo", { text: "again" });
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ text: "again" }) }]);
    expect(wiring.connects()).toBe(2);
  });

  it("pools a warm client across calls (one connect for many calls)", async () => {
    const { broker, wiring } = makeBroker();
    open = broker;
    await broker.callTool("office:echo", { text: "a" });
    await broker.callTool("office:echo", { text: "b" });
    await broker.listTools();
    expect(wiring.connects()).toBe(1);
  });

  it("detects a rug-pull: the manifest hash changes when the catalog mutates", async () => {
    const state: FakeCatalogState = { mutated: false };
    const { broker } = makeBroker(state);
    open = broker;
    const before = await broker.listTools();
    state.mutated = true;
    const after = await broker.listTools();
    expect(after.hash).not.toBe(before.hash);
    expect(after.tools.map((t) => t.id)).toContain("office:extra");
  });
});
