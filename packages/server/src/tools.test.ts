import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DashboardStore } from "@boardstate/core";
import { FsStorageAdapter } from "@boardstate/core/node";
import { Command } from "commander";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { registerDashboardCli } from "./cli/index.js";
import { createDashboardTools } from "./tools-node.js";

async function withTempStateDir<T>(run: (stateDir: string) => Promise<T>): Promise<T> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "boardstate-tools-"));
  try {
    return await run(stateDir);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
}

function storeAt(stateDir: string): DashboardStore {
  return new DashboardStore({ storage: new FsStorageAdapter({ storageDir: stateDir }) });
}

function details(result: unknown): Record<string, unknown> {
  return (result as { details?: Record<string, unknown> }).details ?? {};
}

function toolsByName(store: DashboardStore, broadcast?: (event: string, payload: unknown) => void) {
  return new Map(
    createDashboardTools({
      store,
      ...(broadcast ? { broadcast } : {}),
      context: { agentId: "main", sessionKey: "session-1" },
    }).map((tool) => [tool.name, tool]),
  );
}

describe("dashboard tools", () => {
  it("defines strict schemas for every dashboard tool", async () => {
    await withTempStateDir(async (stateDir) => {
      const tools = toolsByName(storeAt(stateDir));
      expect([...tools.keys()]).toEqual([
        "dashboard_workspace_get",
        "dashboard_tab_create",
        "dashboard_tab_update",
        "dashboard_tab_delete",
        "dashboard_tabs_reorder",
        "dashboard_widget_add",
        "dashboard_widget_update",
        "dashboard_widget_move",
        "dashboard_widget_remove",
        "dashboard_layout_set",
        "dashboard_workspace_replace",
        "dashboard_undo",
        "dashboard_widget_catalog",
        "dashboard_design_review",
        "dashboard_widget_scaffold",
        "dashboard_data_read",
      ]);
      const validSamples: Record<string, unknown> = {
        dashboard_workspace_get: {},
        dashboard_design_review: {},
        dashboard_widget_catalog: {},
        dashboard_tab_create: { title: "Finance" },
        dashboard_tab_update: { slug: "main", hidden: true },
        dashboard_tab_delete: { slug: "old" },
        dashboard_tabs_reorder: { order: ["main"] },
        dashboard_widget_add: {
          tab: "main",
          kind: "builtin:markdown",
          grid: { x: 0, y: 0, w: 4, h: 2 },
        },
        dashboard_widget_update: { tab: "main", id: "cost-today", collapsed: true },
        dashboard_widget_move: { tab: "main", id: "cost-today", grid: { x: 4, y: 0, w: 4, h: 2 } },
        dashboard_widget_remove: { tab: "main", id: "cost-today" },
        dashboard_layout_set: {
          tab: "main",
          layout: [{ id: "cost-today", grid: { x: 0, y: 0, w: 4, h: 2 } }],
        },
        dashboard_workspace_replace: {
          doc: {
            schemaVersion: 1,
            workspaceVersion: 1,
            tabs: [
              { slug: "main", title: "Main", hidden: false, createdBy: "system", widgets: [] },
            ],
            widgetsRegistry: {},
            prefs: { tabOrder: ["main"] },
          },
        },
        dashboard_widget_scaffold: { name: "custom-card" },
        dashboard_undo: {},
        dashboard_data_read: { binding: { source: "static", value: { ok: true } } },
      };
      for (const [name, tool] of tools) {
        expect(Value.Check(tool.parameters, validSamples[name])).toBe(true);
        expect(
          Value.Check(tool.parameters, { ...(validSamples[name] as object), extra: true }),
        ).toBe(false);
      }
    });
  });

  it("stamps tool provenance from context and rejects createdBy override params", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      const calls: Array<[string, unknown]> = [];
      const broadcast = (event: string, payload: unknown) => calls.push([event, payload]);
      const tools = toolsByName(store, broadcast);

      await expect(
        tools.get("dashboard_tab_create")?.execute("call-1", { title: "Bad", createdBy: "user" }),
      ).rejects.toThrow("unexpected param");
      await tools.get("dashboard_tab_create")?.execute("call-2", {
        title: "Finance",
        slug: "finance",
      });

      expect((await store.read()).tabs.find((tab) => tab.slug === "finance")).toMatchObject({
        createdBy: "agent:main",
      });
      expect(calls).toEqual([
        [
          "boardstate.changed",
          { workspaceVersion: 2, changedTabSlug: "finance", actor: "agent:main" },
        ],
      ]);
    });
  });

  it("sanitizes agent workspace replacement provenance and approvals", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      const seed = await store.read();
      seed.tabs[0]!.createdBy = "user";
      seed.widgetsRegistry["approved-card"] = {
        status: "approved",
        createdBy: "user",
        approvedBy: "user",
        approvedAt: "2026-01-01T00:00:00.000Z",
      };
      await store.replace(seed, { actor: "user" });

      const tools = toolsByName(store);
      const replacement = structuredClone(await store.read());
      replacement.tabs[0]!.createdBy = "agent:forged";
      replacement.tabs.push({
        slug: "agent-tab",
        title: "Agent Tab",
        hidden: false,
        createdBy: "user",
        widgets: [],
      });
      replacement.prefs.tabOrder.push("agent-tab");
      replacement.widgetsRegistry["approved-card"] = {
        status: "pending",
        createdBy: "agent:forged",
      };
      replacement.widgetsRegistry["new-card"] = {
        status: "approved",
        createdBy: "user",
        approvedBy: "user",
        approvedAt: "2026-01-02T00:00:00.000Z",
      };

      await tools.get("dashboard_workspace_replace")?.execute("call-1", { doc: replacement });

      const next = await store.read();
      expect(next.tabs.find((tab) => tab.slug === "main")?.createdBy).toBe("user");
      expect(next.tabs.find((tab) => tab.slug === "agent-tab")?.createdBy).toBe("agent:main");
      expect(next.widgetsRegistry["approved-card"]).toEqual({
        status: "approved",
        createdBy: "user",
        approvedBy: "user",
        approvedAt: "2026-01-01T00:00:00.000Z",
      });
      expect(next.widgetsRegistry["new-card"]).toEqual({
        status: "pending",
        createdBy: "agent:main",
      });
    });
  });

  it("agent replace can never self-grant a capability (SPEC §17 structural gate)", async () => {
    // Refuted by adversarial verify 2026-07-10: this path bypassed
    // reconcileReplaceApproval, so an agent could write status:"granted" directly.
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      const seed = await store.read();
      seed.capabilitiesRegistry = {
        "existing-cap": {
          status: "granted",
          methods: ["health"],
          streams: [],
          grantedBy: "user",
          grantedAt: "2026-01-01T00:00:00.000Z",
        },
      };
      await store.replace(seed, { actor: "user" });

      const tools = toolsByName(store);
      const replacement = structuredClone(await store.read());
      replacement.capabilitiesRegistry = {
        ...replacement.capabilitiesRegistry,
        "evil-cap": {
          status: "granted",
          methods: ["usage.cost"],
          streams: [],
          grantedBy: "agent:evil",
          grantedAt: "2026-01-02T00:00:00.000Z",
        },
      };
      await tools.get("dashboard_workspace_replace")?.execute("call-1", { doc: replacement });

      const next = await store.read();
      expect(next.capabilitiesRegistry!["existing-cap"]).toMatchObject({ status: "granted" });
      expect(next.capabilitiesRegistry!["evil-cap"]).toMatchObject({ status: "requested" });
      expect(next.capabilitiesRegistry!["evil-cap"]!.grantedBy).toBeUndefined();
      expect(next.capabilitiesRegistry!["evil-cap"]!.grantedAt).toBeUndefined();
    });
  });

  it("coerces JSON-encoded-string props back to the object, and rejects garbage props", async () => {
    // Models routinely double-encode props; a string is a valid JsonValue so it used
    // to sail through and silently strip format/type/labels from every renderer.
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      const tools = toolsByName(store);
      await tools.get("dashboard_tab_create")?.execute("c1", { title: "Ops", slug: "ops" });
      await tools.get("dashboard_widget_add")?.execute("c2", {
        tab: "ops",
        id: "kpi",
        kind: "builtin:stat-card",
        grid: { x: 0, y: 0, w: 3, h: 2 },
        bindings: { value: { source: "static", value: 42184 } },
        props: '{"format": "usd", "label": "Pipeline"}',
      });
      const stored = (await store.read()).tabs
        .find((tab) => tab.slug === "ops")!
        .widgets.find((widget) => widget.id === "kpi")!;
      expect(stored.props).toEqual({ format: "usd", label: "Pipeline" });

      // A string that isn't a JSON object is rejected loudly, not stored.
      await expect(
        tools.get("dashboard_widget_add")?.execute("c3", {
          tab: "ops",
          id: "bad",
          kind: "builtin:stat-card",
          grid: { x: 3, y: 0, w: 3, h: 2 },
          props: "not json",
        }),
      ).rejects.toThrow("props must be a JSON object");

      // The update/patch path coerces the same way.
      await tools.get("dashboard_widget_update")?.execute("c4", {
        tab: "ops",
        id: "kpi",
        props: '{"format": "int"}',
      });
      const patched = (await store.read()).tabs
        .find((tab) => tab.slug === "ops")!
        .widgets.find((widget) => widget.id === "kpi")!;
      expect(patched.props).toEqual({ format: "int" });
    });
  });

  it("mutates widgets, reads data, and broadcasts one change per write", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      const calls: Array<[string, unknown]> = [];
      const broadcast = (event: string, payload: unknown) => calls.push([event, payload]);
      const tools = toolsByName(store, broadcast);

      await tools.get("dashboard_tab_create")?.execute("call-1", { title: "Ops", slug: "ops" });
      const addResult = details(
        await tools.get("dashboard_widget_add")?.execute("call-2", {
          tab: "ops",
          id: "notes",
          kind: "builtin:markdown",
          title: "Notes",
          grid: { x: 0, y: 0, w: 4, h: 2 },
          bindings: { value: { source: "static", value: "hello" } },
        }),
      );
      expect(addResult.doc).toMatchObject({
        tabs: [
          expect.any(Object),
          expect.objectContaining({
            slug: "ops",
            widgets: [expect.objectContaining({ id: "notes", title: "Notes" })],
          }),
        ],
      });
      await tools.get("dashboard_widget_move")?.execute("call-3", {
        tab: "ops",
        id: "notes",
        grid: { x: 4, y: 0, w: 4, h: 2 },
      });
      const data = details(
        await tools.get("dashboard_data_read")?.execute("call-4", {
          binding: { source: "static", value: { ok: true } },
        }),
      );
      expect(data).toEqual({ data: { ok: true } });
      expect(calls).toHaveLength(3);
      expect(calls.every(([event]) => event === "boardstate.changed")).toBe(true);
    });
  });

  it("scaffolds agent-authored widgets as pending with a standalone bridge template", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      const tools = toolsByName(store);

      await tools.get("dashboard_widget_scaffold")?.execute("call-1", {
        name: "agent-chart",
        title: "Agent Chart",
      });

      const widgetDir = path.join(stateDir, "dashboard", "widgets", "agent-chart");
      const htmlPath = path.join(widgetDir, "index.html");
      const html = await fs.readFile(htmlPath, "utf8");
      expect(html).toContain("dashboard:ready");
      expect(html).toContain("dashboard:getData");
      expect(html).toContain("function onData");
      expect(html).not.toMatch(/https?:\/\//);
      expect((await store.read()).widgetsRegistry["agent-chart"]).toMatchObject({
        status: "pending",
        createdBy: "agent:main",
      });

      await fs.writeFile(htmlPath, "custom implementation", "utf8");
      await expect(
        tools.get("dashboard_widget_scaffold")?.execute("call-2", {
          name: "agent-chart",
          title: "Replacement",
        }),
      ).rejects.toThrow("widget already exists");
      expect(await fs.readFile(htmlPath, "utf8")).toBe("custom implementation");
      expect((await store.read()).widgetsRegistry["agent-chart"]).toMatchObject({
        status: "pending",
        createdBy: "agent:main",
      });
    });
  });

  it("rejects scaffold names that would escape the widgets directory", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      const tools = toolsByName(store);

      await expect(
        tools.get("dashboard_widget_scaffold")?.execute("call-1", { name: ".." }),
      ).rejects.toThrow("widget name is invalid");
      await expect(fs.stat(path.join(stateDir, "dashboard", "widget.json"))).rejects.toThrow();
    });
  });

  it("shares one store between tool writes and CLI reads", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      const tools = toolsByName(store);
      await tools.get("dashboard_tab_create")?.execute("call-1", {
        title: "Tool Tab",
        slug: "tool-tab",
      });

      const program = new Command();
      program.exitOverride();
      program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
      registerDashboardCli({ program, stateDir });
      const chunks: string[] = [];
      const originalWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string | Uint8Array): boolean => {
        chunks.push(String(chunk));
        return true;
      }) as typeof process.stdout.write;
      try {
        await program.parseAsync(["dashboard", "tabs", "list", "--json"], { from: "user" });
      } finally {
        process.stdout.write = originalWrite;
      }
      expect(JSON.parse(chunks.join(""))).toMatchObject({
        tabs: [expect.any(Object), expect.objectContaining({ slug: "tool-tab" })],
      });
    });
  });
});
