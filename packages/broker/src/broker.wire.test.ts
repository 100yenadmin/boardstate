// Wire-contract test: the broker against the REAL fake server over BOTH transports —
// a stdio child process and an in-process Streamable-HTTP server on loopback (no
// external network). Asserts the exact request/response shapes cross the wire and that
// the manifest hash is identical across transports and runs (determinism), plus a
// live rug-pull over http.
//
// The stdio leg spawns the COMPILED entry (`dist/fixture/stdio-entry.js`); CI runs
// `pnpm build` before `pnpm test`, so it is present. When the dist entry is absent
// (a local `vitest` with no prior build) the stdio leg is skipped rather than failing.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { McpBroker } from "./broker.js";
import { parseConnectorsConfig } from "./config.js";
import { BrokerToolError } from "./errors.js";
import { startHttpFakeServer, type HttpFakeServer } from "./fixture/http-harness.js";

const STDIO_ENTRY = fileURLToPath(new URL("../dist/fixture/stdio-entry.js", import.meta.url));
const stdioAvailable = existsSync(STDIO_ENTRY);

function stdioBroker(): McpBroker {
  const config = parseConnectorsConfig({
    connectors: [
      { name: "fake", transport: "stdio", command: process.execPath, args: [STDIO_ENTRY] },
    ],
  });
  return new McpBroker(config);
}

async function httpBroker(): Promise<{ broker: McpBroker; server: HttpFakeServer }> {
  const server = await startHttpFakeServer();
  const config = parseConnectorsConfig({
    connectors: [{ name: "fake", transport: "http", url: server.url }],
  });
  return { broker: new McpBroker(config), server };
}

describe.runIf(stdioAvailable)("wire contract — stdio child", () => {
  it("lists the exact namespaced manifest and calls tools over stdio", async () => {
    const broker = stdioBroker();
    try {
      const manifest = await broker.listTools();
      const echo = manifest.tools.find((t) => t.id === "fake:echo");
      expect(echo).toMatchObject({
        id: "fake:echo",
        providerName: "fake__echo",
        connector: "fake",
        tool: "echo",
        readOnly: true,
      });
      expect(echo?.inputSchema).toMatchObject({ type: "object", required: ["text"] });
      expect(manifest.tools.find((t) => t.id === "fake:write_note")?.readOnly).toBe(false);

      const added = await broker.callTool("fake:add", { a: 7, b: 8 });
      expect(added.content).toEqual([{ type: "text", text: JSON.stringify({ sum: 15 }) }]);

      await expect(broker.callTool("fake:boom")).rejects.toBeInstanceOf(BrokerToolError);
    } finally {
      await broker.close();
    }
  }, 20000);
});

describe("wire contract — Streamable HTTP (in-process)", () => {
  let http: HttpFakeServer | null = null;
  afterAll(async () => {
    await http?.close();
  });

  it("lists the exact namespaced manifest and calls tools over http", async () => {
    const { broker, server } = await httpBroker();
    http = server;
    try {
      const manifest = await broker.listTools();
      const echo = manifest.tools.find((t) => t.id === "fake:echo");
      expect(echo).toMatchObject({
        id: "fake:echo",
        providerName: "fake__echo",
        readOnly: true,
      });

      const added = await broker.callTool("fake:add", { a: 10, b: 20 });
      expect(added.content).toEqual([{ type: "text", text: JSON.stringify({ sum: 30 }) }]);

      await expect(broker.callTool("fake:boom")).rejects.toBeInstanceOf(BrokerToolError);
    } finally {
      await broker.close();
    }
  }, 20000);

  it("detects a live rug-pull over the wire (hash moves when the server's catalog mutates)", async () => {
    const { broker, server } = await httpBroker();
    try {
      const before = await broker.listTools();
      server.state.mutated = true;
      const after = await broker.listTools();
      expect(after.hash).not.toBe(before.hash);
      expect(after.tools.map((t) => t.id)).toContain("fake:extra");
    } finally {
      await broker.close();
      await server.close();
    }
  }, 20000);
});

describe.runIf(stdioAvailable)("wire contract — cross-transport determinism", () => {
  it("produces an identical manifest hash over stdio and http", async () => {
    const stdio = stdioBroker();
    const { broker: http, server } = await httpBroker();
    try {
      const [a, b] = await Promise.all([stdio.listTools(), http.listTools()]);
      expect(a.hash).toBe(b.hash);
    } finally {
      await stdio.close();
      await http.close();
      await server.close();
    }
  }, 20000);
});
