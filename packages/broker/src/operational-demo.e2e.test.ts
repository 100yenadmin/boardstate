// The M5 Operational Workspace, PROVEN END TO END and headless (epic #37 demo
// acceptance). This is the whole loop the operational-demo example runs — assembled the
// same way (`installConnectorWorkspace`), driven against the in-repo fake-MCP fixture,
// with a SCRIPTED agent standing in for a live LLM so CI needs no provider key:
//
//   connect → discover → agent boardstate_tool_search (search + request) →
//   operator approve (partial) → readOnly `source:"mcp"` binding renders external data
//   (via `dashboard.connector.read`, the browser host's verb) →
//   agent invokes a granted readOnly tool DIRECTLY + a mutation that PARKS →
//   operator confirm executes it → the agent's turn completes.
//
// It also proves the operator boundary over a REAL WebSocket pair: a networked client
// can render the readOnly binding and PARK a mutation, but can NEVER confirm it
// (`dashboard.action.confirm` ∈ OPERATOR_ONLY_METHODS) — the demo host serves the board
// with the default `allowOperatorMethods: false`, so confirm is the local operator's
// alone (the in-process host).
//
// The real McpBroker + the trust layer's own wire contract are covered in
// broker-actions.wire.test.ts; THIS test adds the agent surface + the read-binding seam,
// i.e. the pieces that turn the substrate into the product.

import { createServer, type Server as HttpServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { DashboardStore, MemoryStorageAdapter, createWsTransport } from "@boardstate/core";
import {
  attachWsTransport,
  createDashboardTools,
  createInProcessHost,
  installConnectorWorkspace,
  nodeRpcDeps,
  registerBoardstateRpc,
  type ConnectorWorkspaceHandle,
  type InProcessHost,
} from "@boardstate/server/node";
import { createAgentChatAgent } from "@boardstate/agent";
import type {
  AssistantTurn,
  ProviderAdapter,
  ProviderDelta,
  ProviderMessage,
  ToolOutcome,
} from "@boardstate/agent";
import type { AgentStreamEvent } from "@boardstate/schema";
import { McpBroker } from "./broker.js";
import { parseConnectorsConfig } from "./config.js";
import { startHttpFakeServer, type HttpFakeServer } from "./fixture/http-harness.js";

// ── a scripted provider: one turn per streamTurn call, no network ─────────────────────
// Each step is either a tool CALL (the model asks to run a tool) or a final TEXT (the
// model stops). The runner reconstructs history via the format* methods; this provider
// ignores the reconstructed messages and just plays its script in order.

type ScriptStep = { tool: string; args: Record<string, unknown> } | { text: string };

class ScriptedProvider implements ProviderAdapter {
  readonly id = "scripted";
  private index = 0;

  constructor(private readonly script: ScriptStep[]) {}

  async *streamTurn(): AsyncIterable<ProviderDelta> {
    const step = this.script[this.index++];
    if (!step) {
      // Nothing left to say — end cleanly (defensive; the scripts below are exact).
      yield { kind: "text-start", id: "t" };
      yield { kind: "text-end", id: "t" };
      yield { kind: "usage", inputTokens: 1, outputTokens: 1 };
      yield { kind: "stop", reason: "end" };
      return;
    }
    if ("text" in step) {
      yield { kind: "text-start", id: "t" };
      yield { kind: "text-delta", id: "t", delta: step.text };
      yield { kind: "text-end", id: "t" };
      yield { kind: "usage", inputTokens: 1, outputTokens: 1 };
      yield { kind: "stop", reason: "end" };
      return;
    }
    const callId = `call-${this.index}`;
    yield { kind: "tool-call-start", callId, name: step.tool };
    yield { kind: "tool-call-ready", callId, name: step.tool, args: step.args };
    yield { kind: "usage", inputTokens: 1, outputTokens: 1 };
    yield { kind: "stop", reason: "tool_use" };
  }

  formatToolResult(callId: string, outcome: ToolOutcome): ProviderMessage {
    return { role: "tool", callId, ok: outcome.ok, content: outcome.value };
  }

  formatAssistantTurn(turn: AssistantTurn): ProviderMessage {
    return { role: "assistant", text: turn.text, toolCalls: turn.toolCalls };
  }
}

// ── the rig: the operational-demo host, wired exactly like the runnable example ───────

type Rig = {
  host: InProcessHost;
  store: DashboardStore;
  workspace: ConnectorWorkspaceHandle;
  broker: McpBroker;
  fake: HttpFakeServer;
  http: HttpServer;
  wsUrl: string;
  runAgent(provider: ProviderAdapter, message: string): Promise<AgentStreamEvent[]>;
  close(): Promise<void>;
};

async function makeRig(): Promise<Rig> {
  const fake = await startHttpFakeServer();
  const broker = new McpBroker(
    parseConnectorsConfig({ connectors: [{ name: "fake", transport: "http", url: fake.url }] }),
  );
  const storage = new MemoryStorageAdapter();
  const store = new DashboardStore({ storage });
  const host = createInProcessHost(store, storage);

  // ONE call wires the whole M5 stack: engine + agent-tool adapter + tool_search backing.
  const workspace = installConnectorWorkspace(host, {
    broker,
    store,
    // Keep the agent's wait for the operator's confirm short so a lost race fails fast.
    mutationTimeoutMs: 15_000,
  });

  // The dashboard tool set (incl. boardstate_tool_search) is a per-turn host factory, so
  // host.tools() = dashboard tools + broker-granted tools, refreshed each turn.
  host.registerTool(
    () =>
      createDashboardTools({
        store,
        broadcast: host.broadcast,
        toolSearch: workspace.toolSearch,
        context: { agentId: "assistant" },
      }),
    { names: [] },
  );

  // Chat plumbing is omitted here — the test drives the ChatAgent function directly
  // (the runnable demo wires createChatSessions + chat.send for a live model).
  registerBoardstateRpc(host, {
    store,
    ...nodeRpcDeps(),
    capabilityToolsHash: workspace.capabilityToolsHash,
  });
  await workspace.ready;

  // Serve the board over a REAL WS pair — default (allowOperatorMethods:false) so a
  // networked client is not the operator.
  const http = createServer();
  attachWsTransport(http, host);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as { port: number }).port;

  return {
    host,
    store,
    workspace,
    broker,
    fake,
    http,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    async runAgent(provider, message) {
      const agent = createAgentChatAgent({ host, provider });
      const events: AgentStreamEvent[] = [];
      await agent(
        { sessionKey: "s1", message },
        {
          emit: (event) => events.push(event),
          signal: new AbortController().signal,
          turnId: "turn",
        },
      );
      return events;
    },
    async close() {
      workspace.stop();
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until a predicate holds (or a short deadline), for the park→confirm interleave. */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor timed out");
    }
    await sleep(10);
  }
}

/**
 * The `details` a named tool returned, correlated through the stream: a `tool-result`
 * carries only a `callId`, so find the matching `tool-call-ready` (which has `name`)
 * and read the result under its `callId`. Returns the last such result.
 */
function allToolResults(events: AgentStreamEvent[], toolName: string): unknown[] {
  const callIds = new Set(
    events
      .filter((event) => event.type === "tool-call-ready" && event.name === toolName)
      .map((event) => (event as { callId: string }).callId),
  );
  return events
    .filter((event) => event.type === "tool-result" && callIds.has(event.callId))
    .map((event) => (event as { result?: unknown }).result);
}

/** The last `details` a named tool returned (most calls in these scripts are single). */
function toolResultDetails(events: AgentStreamEvent[], toolName: string): unknown {
  return allToolResults(events, toolName).at(-1);
}

describe("operational-demo — the whole loop, headless", () => {
  it("agent searches + requests, operator grants a subset, read binding renders, mutation parks + confirms", async () => {
    rig = await makeRig();
    const providerNameOf = async (id: string): Promise<string> => {
      const manifest = await rig!.broker.listTools();
      const entry = manifest.tools.find((tool) => tool.id === id);
      if (!entry) {
        throw new Error(`no such tool: ${id}`);
      }
      return entry.providerName;
    };
    const echoName = await providerNameOf("fake:echo");
    const writeName = await providerNameOf("fake:write_note");

    // ── 1. discovery: the boot grant registration snapshotted the fixture's catalog ──
    const bootGrant = (await rig.store.read()).capabilitiesRegistry!.fake!;
    expect(bootGrant.status).toBe("requested");
    expect(bootGrant.tools).toContain("fake:echo");

    // ── 2. the agent asks: boardstate_tool_search SEARCH then REQUEST ──
    const askEvents = await rig.runAgent(
      new ScriptedProvider([
        {
          tool: "boardstate_tool_search",
          args: { mode: "search", connector: "fake", query: "echo" },
        },
        {
          tool: "boardstate_tool_search",
          args: { mode: "request", connector: "fake", tools: ["fake:echo", "fake:write_note"] },
        },
        { text: "I found and requested the workbook + document tools." },
      ]),
      "Find OfficeCLI-style tools to read a workbook and generate a document.",
    );
    const searchResults = allToolResults(askEvents, "boardstate_tool_search") as Array<{
      mode: string;
      results?: Array<{ id: string }>;
      requested?: string[];
    }>;
    const search = searchResults[0]!;
    const request = searchResults[1]!;
    expect(search.mode).toBe("search");
    expect(search.results!.some((row) => row.id === "fake:echo")).toBe(true);
    // REQUEST appended the ids but can NEVER grant (still `requested` — invariant #2).
    expect(request.mode).toBe("request");
    expect(request.requested).toEqual(expect.arrayContaining(["fake:echo", "fake:write_note"]));
    expect((await rig.store.read()).capabilitiesRegistry!.fake!.status).toBe("requested");

    // ── 3. the operator approves a PARTIAL subset (echo + write_note only) ──
    await rig.host.request("dashboard.capability.approve", {
      name: "fake",
      decision: "granted",
      actor: "user",
      tools: ["fake:echo", "fake:write_note"],
    });
    const grant = (await rig.store.read()).capabilitiesRegistry!.fake!;
    expect(grant.status).toBe("granted");
    expect(grant.tools).toEqual(["fake:echo", "fake:write_note"]);

    // ── 4. a readOnly `source:"mcp"` binding renders external data, over the WIRE ──
    // This is the exact verb the browser host (@boardstate/host) uses to resolve an
    // `mcp` binding: dashboard.connector.read (readOnly-only, never parks).
    const netClient = createWsTransport(rig.wsUrl);
    await netClient.ready;
    const readResult = (await netClient.request("dashboard.connector.read", {
      connector: "fake",
      tool: "echo",
      args: { text: "Q3 revenue = $4.2M" },
    })) as { content: Array<{ text: string }> };
    expect(JSON.stringify(readResult.content)).toContain("Q3 revenue = $4.2M");

    // A networked client may PARK a mutation but can NEVER confirm it (operator-only).
    const parked = (await netClient.request("dashboard.action.invoke", {
      connector: "fake",
      tool: "write_note",
      args: { text: "networked park" },
    })) as { pending: boolean; id: string };
    expect(parked.pending).toBe(true);
    await expect(netClient.request("dashboard.action.confirm", { id: parked.id })).rejects.toThrow(
      /operator/i,
    );
    // Clean it up so it doesn't linger; the local operator denies it.
    await rig.host.request("dashboard.action.deny", { id: parked.id, actor: "user" });
    netClient.close();

    // ── 5. the agent ACTS: readOnly tool executes directly; mutation parks + confirms ──
    const actProvider = new ScriptedProvider([
      { tool: echoName, args: { text: "read the workbook summary" } },
      { tool: writeName, args: { text: "generate the quarterly report .docx" } },
      { text: "The report board is built; the document is generated." },
    ]);
    const actPromise = rig.runAgent(actProvider, "Build the quarterly report board.");

    // The agent's mutation parks; the LOCAL OPERATOR (in-process host) confirms it.
    await waitFor(() => rig!.workspace.actions.pendingActions().length === 1);
    // Let the adapter register its confirm waiter before we confirm (park→await race).
    await sleep(50);
    const pending = rig.workspace.actions.pendingActions()[0]!;
    expect(pending.connector).toBe("fake");
    expect(pending.tool).toBe("write_note");
    await rig.host.request("dashboard.action.confirm", { id: pending.id, actor: "user" });

    const actEvents = await actPromise;

    // The readOnly tool executed directly and its result reached the model, framed untrusted.
    const echoDetails = JSON.stringify(toolResultDetails(actEvents, echoName));
    expect(echoDetails).toMatch(/UNTRUSTED/);
    expect(echoDetails).toContain("read the workbook summary");

    // The mutation executed only after the operator confirm; the agent got the result.
    const writeDetails = JSON.stringify(toolResultDetails(actEvents, writeName));
    expect(writeDetails).toContain("generate the quarterly report .docx");

    // The action's terminal state is confirmed + single-shot, and the audit recorded it.
    expect(rig.workspace.actions.pendingActions()).toHaveLength(0);
    const confirmed = rig.workspace.actions
      .auditLog()
      .some((entry) => entry.event === "confirm" && entry.outcome === "executed");
    expect(confirmed).toBe(true);

    // The agent turn completed with a final assistant message.
    expect(actEvents.some((event) => event.type === "turn-end")).toBe(true);
  });
});
