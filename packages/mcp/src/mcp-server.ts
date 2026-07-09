// The Boardstate MCP server: exposes the full agent dashboard tool set to ANY MCP
// client over a local fs-backed store, plus a live `boardstate://workspace` resource
// a human (or a pull-only client) can watch.
//
// The tools ARE the `@boardstate/server` agent tools (`dashboard_*`), re-surfaced
// under `boardstate_*` MCP names with their typebox schemas passed through as
// standard JSON Schema `inputSchema`. Writes go through one shared `DashboardStore`;
// every mutation fans out to (a) `notifications/resources/updated` for the workspace
// resource and (b) `boardstate.changed` on the in-process host bus (which the
// optional `--serve` demo page consumes), and each mutating tool also returns
// `{ doc, workspaceVersion }` so a pull-only client stays current without subscribing.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { DashboardStore, type StorageAdapter } from "@boardstate/core";
import { FsStorageAdapter } from "@boardstate/core/node";
import {
  agentToolToJsonSchema,
  createDashboardTools,
  createInProcessHost,
  nodeRpcDeps,
  formatError,
  registerBoardstateRpc,
  type AgentTool,
  type InProcessHost,
} from "@boardstate/server/node";

export const SERVER_NAME = "boardstate-mcp";
export const SERVER_VERSION = "0.0.0";

/** The single workspace resource every client can read and subscribe to. */
export const WORKSPACE_RESOURCE_URI = "boardstate://workspace";

/** Agent tools ship as `dashboard_*`; the brand surfaces them as `boardstate_*`. */
const AGENT_TOOL_PREFIX = "dashboard_";
const MCP_TOOL_PREFIX = "boardstate_";

/** Approval is an operator action wired straight to the control-plane RPC. */
export const APPROVE_TOOL_NAME = "boardstate_widget_approve";

const APPROVE_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "decision"],
  properties: {
    name: { type: "string", description: "Custom widget name to approve or reject." },
    decision: {
      type: "string",
      enum: ["approved", "rejected"],
      description: "Approval decision for the pending widget.",
    },
  },
} as const;

/** Map an agent-tool name (`dashboard_*`) to its MCP name (`boardstate_*`). */
function toMcpToolName(agentName: string): string {
  return agentName.startsWith(AGENT_TOOL_PREFIX)
    ? `${MCP_TOOL_PREFIX}${agentName.slice(AGENT_TOOL_PREFIX.length)}`
    : agentName;
}

/** Reverse of {@link toMcpToolName}. */
function toAgentToolName(mcpName: string): string {
  return mcpName.startsWith(MCP_TOOL_PREFIX)
    ? `${AGENT_TOOL_PREFIX}${mcpName.slice(MCP_TOOL_PREFIX.length)}`
    : mcpName;
}

/** Strip typebox symbol keys so a plain-object schema emits as plain JSON Schema. The
 *  agent-tool schemas use the shared `agentToolToJsonSchema` util; this local strip
 *  only covers the non-tool APPROVE schema below. */
function toJsonSchema(schema: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema ?? {})) as Record<string, unknown>;
}

function textResult(details: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details) }],
    ...(isError ? { isError: true } : {}),
  };
}

export type BoardstateMcpServer = {
  /** The low-level MCP `Server`; `connect(transport)` to drive it. */
  server: Server;
  /** The shared store both the MCP tools and the `--serve` demo page write through. */
  store: DashboardStore;
  /** The in-process control-plane host (owns the `boardstate.changed` bus). */
  host: InProcessHost;
};

export type CreateBoardstateMcpServerOptions = {
  /** State dir root (else `BOARDSTATE_STATE_DIR` env, else `~/.boardstate`). */
  stateDir?: string;
  /** Inject a store (tests); otherwise one is built over an fs adapter. */
  store?: DashboardStore;
  /** Inject a storage adapter (tests); otherwise an fs adapter is used. */
  storage?: StorageAdapter;
};

/**
 * Build a Boardstate MCP server over a local store. The returned `server` is not yet
 * connected — hand it an MCP transport (stdio in the CLI, in-memory in tests).
 */
export function createBoardstateMcpServer(
  options: CreateBoardstateMcpServerOptions = {},
): BoardstateMcpServer {
  const storage =
    options.storage ??
    new FsStorageAdapter(options.stateDir ? { storageDir: options.stateDir } : {});
  const store = options.store ?? new DashboardStore({ storage });
  const host = createInProcessHost(store, storage);
  registerBoardstateRpc(host, { store, dataRead: { stateDir: store.stateDir }, ...nodeRpcDeps() });

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: { subscribe: true, listChanged: true } } },
  );

  // Every write (tool OR the approve RPC) lands on the host bus; forward it to the
  // resource-updated notification so subscribed clients refetch the workspace.
  host.addEventListener("boardstate.changed", () => {
    void server.sendResourceUpdated({ uri: WORKSPACE_RESOURCE_URI }).catch(() => {
      // Pre-connect / transport-closed: the pull path (`{ doc, workspaceVersion }`
      // on each tool result) keeps clients current, so a missed push is non-fatal.
    });
  });

  // The MCP client's advertised name becomes the tool actor (`agent:<name>`), so
  // provenance in the doc reflects who is driving this server.
  const clientAgentId = (): string => server.getClientVersion()?.name ?? "agent";
  const buildTools = (agentId: string): AgentTool[] =>
    createDashboardTools({ store, context: { agentId }, broadcast: host.broadcast });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = buildTools(clientAgentId()).map((tool) => {
      const schema = agentToolToJsonSchema(tool);
      return {
        name: toMcpToolName(schema.name),
        description: schema.description,
        inputSchema: schema.inputSchema,
      };
    });
    tools.push({
      name: APPROVE_TOOL_NAME,
      description:
        "Approve or reject a pending custom widget. NOTE: approval is an operator " +
        "action — in a shared setup a human should own this decision, not the agent.",
      inputSchema: toJsonSchema(APPROVE_INPUT_SCHEMA),
    });
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const mcpName = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      if (mcpName === APPROVE_TOOL_NAME) {
        // Operator action → the control-plane RPC, stamped as the operator (`user`).
        const result = await host.request("dashboard.widget.approve", {
          name: args.name,
          decision: args.decision,
          actor: "user",
        });
        return textResult(result);
      }
      const agentName = toAgentToolName(mcpName);
      const tool = buildTools(clientAgentId()).find((entry) => entry.name === agentName);
      if (!tool) {
        return textResult({ error: `unknown tool: ${mcpName}` }, true);
      }
      const { details } = await tool.execute(mcpName, args);
      return textResult(details);
    } catch (error) {
      return textResult({ error: formatError(error) }, true);
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: WORKSPACE_RESOURCE_URI,
        name: "Boardstate workspace",
        description: "The current dashboard workspace document as JSON.",
        mimeType: "application/json",
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== WORKSPACE_RESOURCE_URI) {
      throw new Error(`unknown resource: ${request.params.uri}`);
    }
    const doc = await store.read();
    return {
      contents: [
        {
          uri: WORKSPACE_RESOURCE_URI,
          mimeType: "application/json",
          text: JSON.stringify(doc),
        },
      ],
    };
  });

  // We push updates unconditionally, so subscribe/unsubscribe just acknowledge.
  server.setRequestHandler(SubscribeRequestSchema, async () => ({}));
  server.setRequestHandler(UnsubscribeRequestSchema, async () => ({}));

  return { server, store, host };
}
