import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DashboardStore, MemoryStorageAdapter } from "@boardstate/core";
import { FsStorageAdapter } from "@boardstate/core/node";
import { describe, expect, it } from "vitest";
import {
  APPROVE_TOOL_NAME,
  WORKSPACE_RESOURCE_URI,
  createBoardstateMcpServer,
} from "./mcp-server.js";

async function connect(clientName = "test-agent", store?: DashboardStore) {
  store ??= new DashboardStore({ storage: new MemoryStorageAdapter() });
  const { server } = createBoardstateMcpServer({ store });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: clientName, version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, store };
}

function parseToolResult(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const first = result.content[0];
  expect(first?.type).toBe("text");
  return JSON.parse(first!.text!);
}

const EXPECTED_TOOL_NAMES = [
  "boardstate_workspace_get",
  "boardstate_tab_create",
  "boardstate_tab_update",
  "boardstate_tab_delete",
  "boardstate_tabs_reorder",
  "boardstate_widget_add",
  "boardstate_widget_update",
  "boardstate_widget_move",
  "boardstate_widget_remove",
  "boardstate_layout_set",
  "boardstate_workspace_replace",
  "boardstate_widget_scaffold",
  "boardstate_undo",
  "boardstate_widget_catalog",
  "boardstate_design_review",
  "boardstate_board_view",
  "boardstate_data_read",
  "boardstate_widget_approve",
];

describe("@boardstate/mcp server", () => {
  it("lists every dashboard tool under a boardstate_ name plus approve", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
    // No dashboard_* names leak through the brand rename.
    expect(tools.some((tool) => tool.name.startsWith("dashboard_"))).toBe(false);
  });

  it("emits a standard JSON Schema inputSchema for every tool", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    for (const tool of tools) {
      // typebox 1.x emits standard JSON Schema: object root, no symbol/typebox leakage.
      expect(tool.inputSchema.type).toBe("object");
      const serialized = JSON.stringify(tool.inputSchema);
      expect(serialized).not.toContain("Kind");
      expect(serialized).not.toContain("[Symbol");
    }
    const schemasByName = Object.fromEntries(tools.map((tool) => [tool.name, tool.inputSchema]));
    expect(schemasByName).toMatchSnapshot();
  });

  it("creates a tab, persists it to the store, and returns { doc, workspaceVersion }", async () => {
    const { client, store } = await connect("claude-code");
    const result = await client.callTool({
      name: "boardstate_tab_create",
      arguments: { title: "Ops", slug: "ops" },
    });
    const payload = parseToolResult(result as never) as {
      doc: { tabs: Array<{ slug: string; createdBy: string }> };
      workspaceVersion: number;
    };
    expect(payload.doc.tabs.some((tab) => tab.slug === "ops")).toBe(true);
    // The MCP client name is stamped as the actor provenance.
    expect(payload.doc.tabs.find((tab) => tab.slug === "ops")?.createdBy).toBe("agent:claude-code");
    expect(payload.workspaceVersion).toBeGreaterThan(0);

    const persisted = await store.read();
    expect(persisted.tabs.some((tab) => tab.slug === "ops")).toBe(true);
  });

  it("fires a resources/updated notification after a mutation", async () => {
    const { client } = await connect();
    let updatedUri: string | undefined;
    const seen: string[] = [];
    client.fallbackNotificationHandler = async (notification) => {
      if (notification.method === "notifications/resources/updated") {
        updatedUri = (notification.params as { uri?: string } | undefined)?.uri;
      }
      seen.push(notification.method);
    };
    await client.callTool({ name: "boardstate_tab_create", arguments: { title: "Live" } });
    // Give the async notification a tick to arrive.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).toContain("notifications/resources/updated");
    expect(updatedUri).toBe(WORKSPACE_RESOURCE_URI);
  });

  it("exposes the workspace as a readable resource", async () => {
    const { client } = await connect();
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toContain(WORKSPACE_RESOURCE_URI);

    await client.callTool({ name: "boardstate_tab_create", arguments: { title: "Docs" } });
    const read = await client.readResource({ uri: WORKSPACE_RESOURCE_URI });
    const doc = JSON.parse((read.contents[0] as { text: string }).text) as {
      tabs: Array<{ title: string }>;
    };
    expect(doc.tabs.some((tab) => tab.title === "Docs")).toBe(true);
  });

  it("approves a pending custom widget via the operator RPC", async () => {
    // A real state dir: scaffoldDashboardWidget writes widget files to disk.
    const dir = await mkdtemp(path.join(tmpdir(), "bs-mcp-"));
    try {
      const store = new DashboardStore({ storage: new FsStorageAdapter({ storageDir: dir }) });
      const { client } = await connect("test-agent", store);
      const scaffold = await client.callTool({
        name: "boardstate_widget_scaffold",
        arguments: { name: "metrics", title: "Metrics" },
      });
      parseToolResult(scaffold as never);
      expect((await store.read()).widgetsRegistry.metrics?.status).toBe("pending");

      const approved = await client.callTool({
        name: APPROVE_TOOL_NAME,
        arguments: { name: "metrics", decision: "approved" },
      });
      const payload = parseToolResult(approved as never) as {
        doc: { widgetsRegistry: Record<string, { status: string; approvedBy?: string }> };
      };
      expect(payload.doc.widgetsRegistry.metrics?.status).toBe("approved");
      expect(payload.doc.widgetsRegistry.metrics?.approvedBy).toBe("user");
      expect((await store.read()).widgetsRegistry.metrics?.status).toBe("approved");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exposes the MCP Apps board view: linked tool meta + a self-contained ui:// resource", async () => {
    const { client } = await connect();
    // The tool advertises its UI resource via the SEP-1865 nested meta key.
    const { tools } = await client.listTools();
    const boardTool = tools.find((tool) => tool.name === "boardstate_board_view");
    expect(boardTool?._meta).toMatchObject({ ui: { resourceUri: "ui://boardstate/board.html" } });

    // The resource lists with the Apps mimeType and reads back as self-contained HTML.
    const { resources } = await client.listResources();
    const boardResource = resources.find((r) => r.uri === "ui://boardstate/board.html");
    expect(boardResource?.mimeType).toBe("text/html;profile=mcp-app");
    const read = await client.readResource({ uri: "ui://boardstate/board.html" });
    const html = (read.contents[0] as { text: string }).text;
    expect(html).toContain("boardstate-view"); // the client creates the element
    expect(html).toContain("<script>"); // the inlined client bundle
    expect(html.length).toBeGreaterThan(100_000); // genuinely self-contained
    // Deny-by-default CSP means the page may fetch NOTHING: no external URLs in tags.
    expect(html).not.toMatch(/src="https?:/);
    expect(html).not.toMatch(/href="https?:/);

    // Calling the tool returns the JSON summary (the text fallback for non-UI hosts).
    const result = await client.callTool({ name: "boardstate_board_view", arguments: {} });
    const payload = parseToolResult(result as never) as { workspaceVersion: number };
    expect(payload.workspaceVersion).toBeGreaterThanOrEqual(0);
  });

  it("returns an isError result for an invalid tool call", async () => {
    const { client } = await connect();
    const result = (await client.callTool({
      name: "boardstate_tab_create",
      arguments: {},
    })) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
    expect(result.isError).toBe(true);
    expect(parseToolResult(result)).toMatchObject({ error: expect.stringContaining("title") });
  });
});
