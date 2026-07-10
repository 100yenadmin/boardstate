// M5c agent surface (issues #42 + #43), driven over a rich FAKE broker (full manifest
// entries: providerName + inputSchema + description + readOnly) plus the REAL
// pending-action engine (installBrokerActions), grant lifecycle (dashboard.capability.approve),
// and the in-process host. Covers:
//   #42 — grant/revoke per-turn pickup, readOnly direct execution, mutation park→confirm,
//         deny/timeout refusals (never a throw), the untrusted-data framing, and the
//         wire-contract param shape crossing execute → broker.callTool.
//   #43 — boardstate_tool_search: bounded schema-free SEARCH, append-only REQUEST that can
//         never grant (re-pends a granted grant), partial-grant callability, and the
//         no-broker clear-error noop.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DashboardStore } from "@boardstate/core";
import { FsStorageAdapter } from "@boardstate/core/node";
import { createInProcessHost, type AgentTool, type InProcessHost } from "./host.js";
import { registerBoardstateRpc } from "./rpc.js";
import { nodeRpcDeps } from "./node.js";
import { installBrokerActions, type BrokerActionsHandle } from "./broker-actions.js";
import {
  createBrokerToolSearch,
  installBrokerAgentTools,
  type AgentToolBroker,
  type BrokerToolEntry,
  type BrokerToolSnapshot,
  type InstallBrokerAgentToolsHandle,
} from "./broker-agent-tools.js";
import { createDashboardCoreTools, type ToolSearchCapability } from "./tools.js";

const CONNECTOR = "acme";

/** The fake connector's catalog: three reads, two mutations, one always-erroring read. */
function catalog(): BrokerToolEntry[] {
  const entry = (
    tool: string,
    readOnly: boolean,
    props: Record<string, unknown> = {},
  ): BrokerToolEntry => ({
    id: `${CONNECTOR}:${tool}`,
    providerName: `${CONNECTOR}__${tool}`,
    connector: CONNECTOR,
    tool,
    description: `The ${tool} tool.`,
    inputSchema: { type: "object", additionalProperties: false, properties: props },
    readOnly,
  });
  return [
    entry("echo", true, { text: { type: "string" } }),
    entry("lookup", true, { q: { type: "string" } }),
    entry("status", true, {}),
    entry("write_note", false, { text: { type: "string" } }),
    entry("send", false, { to: { type: "string" }, body: { type: "string" } }),
    entry("boom", true, {}),
  ];
}

/** A rich fake broker: full manifest entries + a call log for the wire-contract assertion. */
class FakeBroker implements AgentToolBroker {
  readonly calls: Array<{ id: string; args: Record<string, unknown> }> = [];
  constructor(private readonly entries: BrokerToolEntry[] = catalog()) {}

  connectorNames(): string[] {
    return [...new Set(this.entries.map((e) => e.connector))];
  }

  async listTools(): Promise<BrokerToolSnapshot> {
    const tools = this.entries.map((e) => ({ ...e }));
    return {
      tools,
      hash: this.hashToolSubset(
        { tools, hash: "" },
        tools.map((e) => e.id),
      ),
    };
  }

  async callTool(
    toolRef: string,
    args: Record<string, unknown> = {},
  ): Promise<{ content: unknown; structuredContent?: unknown }> {
    this.calls.push({ id: toolRef, args });
    if (toolRef.endsWith(":boom")) {
      throw new Error("boom: tool failed");
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
      structuredContent: { ok: true, id: toolRef, args },
    };
  }

  hashToolSubset(manifest: BrokerToolSnapshot, toolIds: readonly string[]): string {
    const set = new Set(toolIds);
    const tuples = manifest.tools
      .filter((e) => set.has(e.id))
      .map((e) => [e.id, e.readOnly === true, JSON.stringify(e.inputSchema)] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return createHash("sha256").update(JSON.stringify(tuples)).digest("hex");
  }
}

type Harness = {
  store: DashboardStore;
  host: InProcessHost;
  broker: FakeBroker;
  actions: BrokerActionsHandle;
  agentTools: InstallBrokerAgentToolsHandle;
  toolSearch: ToolSearchCapability;
  stateDir: string;
};

const harnesses: Harness[] = [];

async function setup(opts: { mutationTimeoutMs?: number } = {}): Promise<Harness> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "boardstate-agentsurface-"));
  const storage = new FsStorageAdapter({ storageDir: stateDir });
  const store = new DashboardStore({ storage });
  const host = createInProcessHost(store, storage);
  const broker = new FakeBroker();
  const actions = installBrokerActions(host, { broker, store });
  registerBoardstateRpc(host, {
    store,
    dataRead: { stateDir },
    ...nodeRpcDeps(),
    capabilityToolsHash: actions.capabilityToolsHash,
  });
  const toolSearch = createBrokerToolSearch({ broker, store, broadcast: host.broadcast });
  // Core tools (incl. boardstate_tool_search) — one factory; broker tools — another.
  host.registerTool(
    () =>
      createDashboardCoreTools({
        store,
        broadcast: host.broadcast,
        context: { agentId: "a" },
        toolSearch,
      }),
    { names: [] },
  );
  const agentTools = installBrokerAgentTools(host, {
    broker,
    store,
    actions,
    ...(opts.mutationTimeoutMs !== undefined ? { mutationTimeoutMs: opts.mutationTimeoutMs } : {}),
  });
  await actions.ready;
  await agentTools.ready;
  const h: Harness = { store, host, broker, actions, agentTools, toolSearch, stateDir };
  harnesses.push(h);
  return h;
}

afterEach(async () => {
  while (harnesses.length) {
    const h = harnesses.pop()!;
    h.actions.stop();
    h.agentTools.stop();
    await fs.rm(h.stateDir, { recursive: true, force: true });
  }
});

/** Approve (grant) a connector's tool subset through the operator RPC, then refresh the adapter. */
async function grant(h: Harness, tools: string[] | undefined): Promise<void> {
  await h.host.request("dashboard.capability.approve", {
    name: CONNECTOR,
    decision: "granted",
    ...(tools ? { tools } : {}),
  });
  await h.agentTools.refresh();
}

const toolNames = (h: Harness): string[] => h.host.tools().map((t) => t.name);
const getTool = (h: Harness, name: string): AgentTool | undefined =>
  h.host.tools().find((t) => t.name === name);

/** Poll for the first pending action id (the adapter's mutation path parks one). */
async function nextPendingId(h: Harness): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const pending = h.actions.pendingActions();
    if (pending.length > 0) {
      return pending[0]!.id;
    }
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error("no pending action appeared");
}

describe("broker→AgentTool adapter (#42)", () => {
  it("exposes a granted tool next turn, and drops it after revoke (per-turn pickup)", async () => {
    const h = await setup();
    expect(toolNames(h)).not.toContain("acme__echo");

    await grant(h, ["acme:echo"]);
    expect(toolNames(h)).toContain("acme__echo");

    await h.host.request("dashboard.capability.approve", { name: CONNECTOR, decision: "revoked" });
    await h.agentTools.refresh();
    expect(toolNames(h)).not.toContain("acme__echo");
  });

  it("frames the tool description as untrusted external content and marks it external", async () => {
    const h = await setup();
    await grant(h, ["acme:echo"]);
    const tool = getTool(h, "acme__echo")!;
    expect(tool.external).toBe(true);
    expect(tool.readOnly).toBe(true);
    expect(tool.description).toContain("UNTRUSTED");
    expect(tool.name).toBe("acme__echo"); // provider-safe name, never a colon id
  });

  it("executes a granted readOnly tool directly, framing the result as untrusted data", async () => {
    const h = await setup();
    await grant(h, ["acme:echo"]);
    const args = { text: "hello" };
    const { details } = (await getTool(h, "acme__echo")!.execute("c1", args)) as {
      details: Record<string, unknown>;
    };
    expect(details.external).toBe(true);
    expect(details.connector).toBe(CONNECTOR);
    expect(String(details.note)).toContain("UNTRUSTED");
    // Wire-contract: the exact args object crosses execute → broker.callTool.
    expect(h.broker.calls).toEqual([{ id: "acme:echo", args }]);
  });

  it("routes a mutation through the pending-action engine: parks, then executes on confirm", async () => {
    const h = await setup();
    await grant(h, ["acme:send"]);
    const args = { to: "ops", body: "ship it" };
    const pending = getTool(h, "acme__send")!.execute("c2", args);

    const id = await nextPendingId(h);
    // Nothing has hit the connector yet — it is parked awaiting the operator.
    expect(h.broker.calls).toEqual([]);
    await h.host.request("dashboard.action.confirm", { id });

    const { details } = (await pending) as { details: Record<string, unknown> };
    expect(details.external).toBe(true);
    expect(details.refused).toBeUndefined();
    // Wire-contract on the mutation path too: the same args reach the connector.
    expect(h.broker.calls).toEqual([{ id: "acme:send", args }]);
  });

  it("returns a model-legible refusal (not a throw) when the operator denies", async () => {
    const h = await setup();
    await grant(h, ["acme:send"]);
    const pending = getTool(h, "acme__send")!.execute("c3", { to: "x", body: "y" });
    const id = await nextPendingId(h);
    await h.host.request("dashboard.action.deny", { id });

    const { details } = (await pending) as { details: Record<string, unknown> };
    expect(details.refused).toBe(true);
    expect(String(details.reason)).toContain("denied");
    expect(h.broker.calls).toEqual([]);
  });

  it("returns a refusal when the agent's wait for confirm times out", async () => {
    const h = await setup({ mutationTimeoutMs: 15 });
    await grant(h, ["acme:send"]);
    const { details } = (await getTool(h, "acme__send")!.execute("c4", { to: "x", body: "y" })) as {
      details: Record<string, unknown>;
    };
    expect(details.refused).toBe(true);
    expect(String(details.reason)).toContain("timed out");
  });

  it("frames a broker error on a readOnly call as data, not a thrown turn-killer", async () => {
    const h = await setup();
    await grant(h, ["acme:boom"]);
    const { details } = (await getTool(h, "acme__boom")!.execute("c5", {})) as {
      details: Record<string, unknown>;
    };
    expect(details.ok).toBe(false);
    expect(String(details.error)).toContain("boom");
  });
});

describe("boardstate_tool_search (#43)", () => {
  const search = (h: Harness) => getTool(h, "boardstate_tool_search")!;

  it("SEARCH returns bounded rows with one-line descriptions and NO input schemas", async () => {
    const h = await setup();
    const { details } = (await search(h).execute("s1", { mode: "search", limit: 3 })) as {
      details: { results: Array<Record<string, unknown>>; bound: number };
    };
    expect(details.bound).toBe(3);
    expect(details.results.length).toBeLessThanOrEqual(3);
    for (const row of details.results) {
      expect(row).toHaveProperty("id");
      expect(row).toHaveProperty("readOnly");
      expect(row).not.toHaveProperty("inputSchema");
      expect(row).not.toHaveProperty("parameters");
    }
  });

  it("SEARCH filters by query", async () => {
    const h = await setup();
    const { details } = (await search(h).execute("s2", { mode: "search", query: "send" })) as {
      details: { results: Array<{ id: string }> };
    };
    expect(details.results.map((r) => r.id)).toEqual(["acme:send"]);
  });

  it("REQUEST is append-only to `requested` and can NEVER grant — it re-pends a granted grant", async () => {
    const h = await setup();
    await grant(h, ["acme:echo"]);
    expect(toolNames(h)).toContain("acme__echo");

    const { details } = (await search(h).execute("r1", {
      mode: "request",
      connector: CONNECTOR,
      tools: ["acme:send"],
    })) as { details: Record<string, unknown> };
    expect(details.status).toBe("requested");
    expect(details.requested).toEqual(expect.arrayContaining(["acme:echo", "acme:send"]));

    const doc = await h.store.read();
    const g = doc.capabilitiesRegistry![CONNECTOR]!;
    // The granted grant re-pended: status flipped BACK to requested, never granted.
    expect(g.status).toBe("requested");
    expect(g.tools).toEqual(expect.arrayContaining(["acme:echo", "acme:send"]));
    // And the previously-callable tool is gone next turn (grant no longer granted).
    await h.agentTools.refresh();
    expect(toolNames(h)).not.toContain("acme__echo");
  });

  it("end-to-end: request 5 → operator grants 2 → exactly those 2 are callable", async () => {
    const h = await setup();
    const requested = ["acme:echo", "acme:lookup", "acme:status", "acme:write_note", "acme:send"];
    await search(h).execute("r2", { mode: "request", connector: CONNECTOR, tools: requested });

    // Operator grants a partial subset of two.
    await grant(h, ["acme:echo", "acme:lookup"]);

    const names = toolNames(h);
    expect(names).toContain("acme__echo");
    expect(names).toContain("acme__lookup");
    expect(names).not.toContain("acme__status");
    expect(names).not.toContain("acme__write_note");
    expect(names).not.toContain("acme__send");
  });

  it("ignores unknown tool ids and refuses an unconfigured connector (config authorship)", async () => {
    const h = await setup();
    const { details } = (await search(h).execute("r3", {
      mode: "request",
      connector: CONNECTOR,
      tools: ["acme:ghost"],
    })) as { details: Record<string, unknown> };
    expect(details.unknown).toEqual(["acme:ghost"]);
    // No known tool to add ⇒ no grant materialized for a pure typo.
    const doc = await h.store.read();
    expect(doc.capabilitiesRegistry![CONNECTOR]?.status).toBe("requested"); // from refreshGrants, untouched

    await expect(
      search(h).execute("r4", { mode: "request", connector: "ghost", tools: ["ghost:x"] }),
    ).rejects.toThrow(/not configured/);
  });

  it("is a clear-error noop when no broker is attached", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "boardstate-nobroker-"));
    const storage = new FsStorageAdapter({ storageDir: stateDir });
    const store = new DashboardStore({ storage });
    const tool = createDashboardCoreTools({ store }).find(
      (t) => t.name === "boardstate_tool_search",
    )!;
    const { details } = (await tool.execute("n1", { mode: "search" })) as {
      details: Record<string, unknown>;
    };
    expect(details.available).toBe(false);
    expect(String(details.error)).toContain("no connector broker");
    await fs.rm(stateDir, { recursive: true, force: true });
  });
});
