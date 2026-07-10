// `installConnectorWorkspace` — the one-call M5 host wiring, over a FAKE dual-interface
// broker (no real MCP). Asserts the assembly: the engine's verbs are registered, the
// tool_search backing works, granted tools reach the agent adapter, and the returned
// seams (capabilityToolsHash / toolSearch) are the real ones. The REAL McpBroker + fake
// fixture drives this same helper end-to-end in @boardstate/broker
// (operational-demo.e2e.test.ts).

import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { DashboardStore, MemoryStorageAdapter } from "@boardstate/core";
import { createInProcessHost, type InProcessHost } from "./host.js";
import { registerBoardstateRpc } from "./rpc.js";
import { nodeRpcDeps } from "./node.js";
import { installConnectorWorkspace, type ConnectorWorkspaceHandle } from "./broker-workspace.js";
import type { BrokerToolEntry, BrokerToolSnapshot } from "./broker-agent-tools.js";

/** A minimal broker satisfying BOTH ActionBroker and AgentToolBroker (WorkspaceBroker). */
class FakeWorkspaceBroker {
  readonly calls: string[] = [];
  private readonly entries: BrokerToolEntry[] = [
    {
      id: "office:read_workbook",
      providerName: "office__read_workbook",
      connector: "office",
      tool: "read_workbook",
      description: "Read a range from a workbook.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      readOnly: true,
    },
    {
      id: "office:generate_document",
      providerName: "office__generate_document",
      connector: "office",
      tool: "generate_document",
      description: "Generate a document (mutating).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      // no readOnly ⇒ mutation (fail-safe).
    },
  ];

  connectorNames(): string[] {
    return ["office"];
  }

  async listTools(): Promise<BrokerToolSnapshot> {
    return {
      tools: [...this.entries],
      hash: this.hashToolSubset(
        { tools: this.entries, hash: "" },
        this.entries.map((entry) => entry.id),
      ),
    };
  }

  async callTool(
    toolRef: string,
    args: Record<string, unknown> = {},
  ): Promise<{ content: unknown; structuredContent?: unknown }> {
    this.calls.push(toolRef);
    return { content: [{ type: "text", text: JSON.stringify({ ref: toolRef, args }) }] };
  }

  hashToolSubset(manifest: BrokerToolSnapshot, toolIds: readonly string[]): string {
    const set = new Set(toolIds);
    const tuples = manifest.tools
      .filter((entry) => set.has(entry.id))
      .map((entry) => [entry.id, entry.readOnly === true] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return createHash("sha256").update(JSON.stringify(tuples)).digest("hex");
  }
}

type Rig = {
  host: InProcessHost;
  store: DashboardStore;
  broker: FakeWorkspaceBroker;
  handle: ConnectorWorkspaceHandle;
};

async function makeRig(): Promise<Rig> {
  const storage = new MemoryStorageAdapter();
  const store = new DashboardStore({ storage });
  const host = createInProcessHost(store, storage);
  const broker = new FakeWorkspaceBroker();
  const handle = installConnectorWorkspace(host, { broker, store });
  // The base control plane owns `dashboard.capability.approve` (operator grant); the
  // workspace helper only supplies the partial-grant hash resolver it threads in.
  registerBoardstateRpc(host, {
    store,
    ...nodeRpcDeps(),
    capabilityToolsHash: handle.capabilityToolsHash,
  });
  await handle.ready;
  return { host, store, broker, handle };
}

let rig: Rig | null = null;
afterEach(() => {
  rig?.handle.stop();
  rig = null;
});

describe("installConnectorWorkspace", () => {
  it("registers the engine verbs (invoke/confirm/deny/list + connector.read)", async () => {
    rig = await makeRig();
    const names = rig.host.listRpc().map((entry) => entry.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "dashboard.action.invoke",
        "dashboard.action.confirm",
        "dashboard.action.deny",
        "dashboard.action.list",
        "dashboard.connector.read",
      ]),
    );
  });

  it("lands a `requested` grant snapshotting the broker's tool ids", async () => {
    rig = await makeRig();
    const grant = (await rig.store.read()).capabilitiesRegistry!.office!;
    expect(grant.status).toBe("requested");
    expect(grant.tools).toEqual(["office:generate_document", "office:read_workbook"]);
    expect(grant.toolsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns a working tool_search backing (SEARCH + REQUEST)", async () => {
    rig = await makeRig();
    const found = await rig.handle.toolSearch.search({ query: "workbook" });
    expect(found.results.map((row) => row.id)).toContain("office:read_workbook");

    const requested = await rig.handle.toolSearch.request({
      connector: "office",
      tools: ["office:read_workbook"],
      actor: "agent:test",
    });
    expect(requested.status).toBe("requested");
    expect(requested.requested).toContain("office:read_workbook");
  });

  it("surfaces a GRANTED tool to the agent adapter and executes readOnly directly", async () => {
    rig = await makeRig();
    // Operator grants the readOnly tool.
    await rig.host.request("dashboard.capability.approve", {
      name: "office",
      decision: "granted",
      actor: "user",
      tools: ["office:read_workbook"],
    });
    await rig.handle.agentTools.refresh();

    const tools = rig.host.tools();
    const readTool = tools.find((tool) => tool.name === "office__read_workbook");
    expect(readTool).toBeDefined();
    expect(readTool!.external).toBe(true);
    expect(readTool!.readOnly).toBe(true);

    const result = await readTool!.execute("call-1", {});
    expect(rig.broker.calls).toContain("office:read_workbook");
    // Framed as untrusted external output.
    expect(JSON.stringify(result)).toMatch(/UNTRUSTED/);
  });

  it("exposes capabilityToolsHash for the partial-grant path", async () => {
    rig = await makeRig();
    const hash = rig.handle.capabilityToolsHash("office", ["office:read_workbook"]);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stop() is idempotent", async () => {
    rig = await makeRig();
    expect(() => {
      rig!.handle.stop();
      rig!.handle.stop();
    }).not.toThrow();
  });
});
