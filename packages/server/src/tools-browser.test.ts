// Regression for the browser tool seam: the reference app shipped with
// `createAgentChatAgent({ host, provider })` and NO tools — `host.tools()` is empty
// in a browser host and the full `createDashboardTools` is node-only (fs scaffold +
// file data reads), so a real provider could chat but never touch the board. The
// browser-safe core set must exist on the ROOT entry and drive real mutations with
// agent provenance.
import { DashboardStore, MemoryStorageAdapter } from "@boardstate/core";
import { describe, expect, it } from "vitest";
// The root entry (not ./tools.js) — proves the export is wired for browser hosts.
import { createDashboardCoreTools } from "./index.js";

function makeTools(events: { event: string; payload: unknown }[]) {
  const store = new DashboardStore({ storage: new MemoryStorageAdapter() });
  const tools = createDashboardCoreTools({
    store,
    context: { agentId: "assistant" },
    broadcast: (event, payload) => events.push({ event, payload }),
  });
  return { store, tools };
}

describe("createDashboardCoreTools (browser-safe)", () => {
  it("exposes the full mutation surface without the node-only tools", () => {
    const { tools } = makeTools([]);
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("dashboard_workspace_get");
    expect(names).toContain("dashboard_tab_create");
    expect(names).toContain("dashboard_widget_add");
    expect(names).toContain("dashboard_undo");
    // fs-backed tools stay behind @boardstate/server/node.
    expect(names).not.toContain("dashboard_widget_scaffold");
    expect(names).not.toContain("dashboard_data_read");
    expect(tools.length).toBeGreaterThanOrEqual(12);
  });

  it("drives a real mutation with agent provenance and one broadcast", async () => {
    const events: { event: string; payload: unknown }[] = [];
    const { store, tools } = makeTools(events);
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    await byName.get("dashboard_tab_create")!.execute("call-1", { title: "Live" });
    const doc = await store.read();
    const tab = doc.tabs.find((entry) => entry.title === "Live");
    expect(tab).toBeDefined();
    expect(tab!.createdBy).toBe("agent:assistant");
    expect(events.filter((entry) => entry.event === "boardstate.changed")).toHaveLength(1);
  });
});
