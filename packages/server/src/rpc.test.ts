import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DashboardStore } from "@boardstate/core";
import { FsStorageAdapter } from "@boardstate/core/node";
import { describe, expect, it } from "vitest";
import { createInProcessHost, type InProcessHost, type RequestContext } from "./host.js";
import { registerBoardstateRpc } from "./rpc.js";
import { nodeRpcDeps } from "./node.js";

// Relative future expiry — a hardcoded date here becomes a time-bomb the day it passes.
const FUTURE_EXPIRY = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const CHANGE_EVENTS = [
  "boardstate.changed",
  "boardstate.presence",
  "boardstate.widget-state.changed",
] as const;

type Call = { event: string; payload: unknown };

async function withHost<T>(
  run: (ctx: {
    host: InProcessHost;
    store: DashboardStore;
    stateDir: string;
    calls: Call[];
  }) => Promise<T>,
): Promise<T> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "boardstate-rpc-"));
  try {
    const storage = new FsStorageAdapter({ storageDir: stateDir });
    const store = new DashboardStore({ storage });
    const host = createInProcessHost(store, storage);
    registerBoardstateRpc(host, { store, dataRead: { stateDir }, ...nodeRpcDeps() });
    const calls: Call[] = [];
    for (const event of CHANGE_EVENTS) {
      host.addEventListener(event, (payload) => calls.push({ event, payload }));
    }
    return await run({ host, store, stateDir, calls });
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
}

/** Run a method, resolving `{ ok, result, error }` instead of throwing. */
async function call(
  host: InProcessHost,
  method: string,
  params?: unknown,
  ctx?: RequestContext,
): Promise<{ ok: boolean; result?: any; error?: { code?: string; message: string } }> {
  try {
    return { ok: true, result: await host.request(method, params, ctx) };
  } catch (error) {
    const err = error as Error & { code?: string };
    return { ok: false, error: { code: err.code, message: err.message } };
  }
}

describe("boardstate control plane", () => {
  it("registers all methods with read/write scopes in the union order", async () => {
    await withHost(async ({ host }) => {
      expect(host.listRpc().map((entry) => entry.name)).toEqual([
        "dashboard.workspace.get",
        "dashboard.tab.create",
        "dashboard.tab.update",
        "dashboard.tab.delete",
        "dashboard.tab.reorder",
        "dashboard.widget.add",
        "dashboard.widget.update",
        "dashboard.widget.move",
        "dashboard.widget.remove",
        "dashboard.widget.setLayout",
        "dashboard.widget.approve",
        "dashboard.capability.approve",
        "dashboard.widget.install",
        "dashboard.workspace.replace",
        "dashboard.workspace.undo",
        "dashboard.workspace.history.list",
        "dashboard.workspace.history.get",
        "dashboard.data.read",
        "dashboard.presence.ping",
        "dashboard.widget.state.get",
        "dashboard.widget.state.set",
      ]);
      const readMethods = new Set([
        "dashboard.workspace.get",
        "dashboard.workspace.history.list",
        "dashboard.workspace.history.get",
        "dashboard.data.read",
        "dashboard.presence.ping",
        "dashboard.widget.state.get",
      ]);
      for (const { name, scope } of host.listRpc()) {
        expect(scope).toBe(readMethods.has(name) ? "read" : "write");
      }
    });
  });

  it("returns the workspace without broadcasting and broadcasts successful writes", async () => {
    await withHost(async ({ host, calls }) => {
      const read = await call(host, "dashboard.workspace.get", {});
      expect(read.ok).toBe(true);
      expect(read.result).toMatchObject({ workspaceVersion: 1 });
      expect(calls).toHaveLength(0);

      const created = await call(host, "dashboard.tab.create", {
        title: "Finance Ops",
        actor: "agent:main",
      });
      expect(created.ok).toBe(true);
      expect(created.result).toMatchObject({
        doc: {
          workspaceVersion: 2,
          tabs: expect.arrayContaining([expect.objectContaining({ slug: "finance-ops" })]),
        },
        workspaceVersion: 2,
      });
      expect(calls).toEqual([
        {
          event: "boardstate.changed",
          payload: { workspaceVersion: 2, changedTabSlug: "finance-ops", actor: "agent:main" },
        },
      ]);
    });
  });

  it("rejects unknown params and bad shapes without broadcasting", async () => {
    await withHost(async ({ host, calls }) => {
      const response = await call(host, "dashboard.tab.create", { title: "Bad", unexpected: true });
      expect(response.ok).toBe(false);
      expect(response.error?.message).toContain("unexpected param");
      expect(calls).toHaveLength(0);
    });
  });

  it("applies widget, workspace replace, undo, and data read methods", async () => {
    await withHost(async ({ host, calls }) => {
      await call(host, "dashboard.tab.create", { slug: "ops", title: "Ops" });
      await call(host, "dashboard.widget.add", {
        tab: "ops",
        widget: { kind: "builtin:markdown", title: "Notes", grid: { x: 0, y: 0, w: 4, h: 2 } },
      });
      const updated = await call(host, "dashboard.widget.update", {
        tab: "ops",
        id: "notes",
        patch: { collapsed: true },
      });
      expect(
        updated.result?.doc.tabs.find((tab: { slug: string }) => tab.slug === "ops"),
      ).toMatchObject({ widgets: [expect.objectContaining({ id: "notes", collapsed: true })] });

      await call(host, "dashboard.widget.move", {
        tab: "ops",
        id: "notes",
        grid: { x: 4, y: 0, w: 4, h: 2 },
      });
      const ambiguousMove = await call(host, "dashboard.widget.move", {
        tab: "ops",
        id: "notes",
        grid: { x: 0, y: 0, w: 4, h: 2 },
        toTab: "main",
      });
      expect(ambiguousMove.ok).toBe(false);
      expect(ambiguousMove.error?.message).toContain("not both");
      await call(host, "dashboard.widget.setLayout", {
        tab: "ops",
        layout: [{ id: "notes", grid: { x: 0, y: 3, w: 6, h: 3 } }],
      });
      await call(host, "dashboard.widget.approve", {
        name: "custom-chart",
        decision: "approved",
      });
      const data = await call(host, "dashboard.data.read", {
        binding: { source: "static", value: { ok: true } },
      });
      expect(data.result).toEqual({ data: { ok: true } });
      const rpcData = await call(host, "dashboard.data.read", {
        binding: { source: "rpc", method: "sessions.list" },
      });
      expect(rpcData.ok).toBe(false);
      expect(rpcData.error?.code).toBe("binding_client_resolved");

      const beforeReplace = await call(host, "dashboard.workspace.get", {});
      const replacement = structuredClone(beforeReplace.result?.doc);
      replacement.tabs = [replacement.tabs.find((tab: { slug: string }) => tab.slug === "ops")];
      replacement.prefs.tabOrder = ["ops"];
      await call(host, "dashboard.workspace.replace", { doc: replacement });

      const undo = await call(host, "dashboard.workspace.undo", {});
      expect(undo.ok).toBe(true);
      expect(undo.result?.doc.tabs.some((tab: { slug: string }) => tab.slug === "main")).toBe(true);
      expect(calls.filter((entry) => entry.event === "boardstate.changed")).toHaveLength(8);
    });
  });
});

describe("full-bleed tab layout (apps-layer)", () => {
  it("persists a full-bleed tab layout via dashboard.tab.update", async () => {
    await withHost(async ({ host }) => {
      await call(host, "dashboard.tab.create", { slug: "ops", title: "Ops" });
      const updated = await call(host, "dashboard.tab.update", {
        slug: "ops",
        patch: { layout: "full" },
      });
      expect(updated.ok).toBe(true);
      expect(
        updated.result?.doc.tabs.find((tab: { slug: string }) => tab.slug === "ops"),
      ).toMatchObject({ layout: "full" });

      const invalid = await call(host, "dashboard.tab.update", {
        slug: "ops",
        patch: { layout: "fullscreen" },
      });
      expect(invalid.ok).toBe(false);
      expect(invalid.error?.message).toContain('layout must be "grid" or "full"');
    });
  });
});

describe("ephemeral widgets (living answers)", () => {
  it("sets an ephemeral flag on add and clears it via a pin (ephemeral: null) patch", async () => {
    await withHost(async ({ host }) => {
      await call(host, "dashboard.tab.create", { slug: "ans", title: "Answers" });
      const added = await call(host, "dashboard.widget.add", {
        tab: "ans",
        widget: {
          id: "answer-1",
          kind: "builtin:markdown",
          grid: { x: 0, y: 0, w: 4, h: 2 },
          ephemeral: { expiresAt: FUTURE_EXPIRY },
        },
      });
      const addedWidget = added.result?.doc.tabs
        .find((tab: { slug: string }) => tab.slug === "ans")
        .widgets.find((w: { id: string }) => w.id === "answer-1");
      expect(addedWidget.ephemeral).toEqual({ expiresAt: FUTURE_EXPIRY });

      const pinned = await call(host, "dashboard.widget.update", {
        tab: "ans",
        id: "answer-1",
        patch: { ephemeral: null },
      });
      const pinnedWidget = pinned.result?.doc.tabs
        .find((tab: { slug: string }) => tab.slug === "ans")
        .widgets.find((w: { id: string }) => w.id === "answer-1");
      expect(pinnedWidget.ephemeral).toBeUndefined();
      expect("ephemeral" in pinnedWidget).toBe(false);
    });
  });
});

describe("time-travel history", () => {
  it("serves undo-ring history as read-only metadata and full snapshots", async () => {
    await withHost(async ({ host, calls }) => {
      await call(host, "dashboard.workspace.get", {});
      await call(host, "dashboard.tab.create", { title: "One" });
      await call(host, "dashboard.tab.create", { title: "Two" });
      await call(host, "dashboard.tab.create", { title: "Three" });

      const before = calls.length;
      const list = await call(host, "dashboard.workspace.history.list", {});
      expect(list.ok).toBe(true);
      const entries = list.result?.entries as Array<{
        version: number;
        savedAt: string;
        bytes: number;
        doc?: unknown;
        summary?: { tabsChanged: number; total: number };
      }>;
      expect(entries.map((entry) => entry.version)).toEqual([3, 2, 1]);
      for (const entry of entries) {
        expect(entry.bytes).toBeGreaterThan(0);
        expect(typeof entry.savedAt).toBe("string");
        expect(entry).not.toHaveProperty("doc");
      }
      // The change summary crosses the RPC intact (each newer snapshot added one tab
      // over its predecessor); the oldest snapshot in the ring has no predecessor.
      expect(entries[0]?.summary).toMatchObject({ tabsChanged: 1, total: 1 });
      expect(entries[1]?.summary).toMatchObject({ tabsChanged: 1, total: 1 });
      expect(entries[2]?.summary).toBeUndefined();

      const snapshot = await call(host, "dashboard.workspace.history.get", { version: 2 });
      expect(snapshot.ok).toBe(true);
      expect(snapshot.result?.doc.workspaceVersion).toBe(2);

      const missing = await call(host, "dashboard.workspace.history.get", { version: 999 });
      expect(missing.ok).toBe(false);
      expect(missing.error?.message).toContain("no dashboard history snapshot");

      const badParam = await call(host, "dashboard.workspace.history.get", { version: -1 });
      expect(badParam.ok).toBe(false);
      expect(badParam.error?.message).toContain("non-negative integer");

      // Read-only: no history call ever broadcasts a change.
      expect(calls.length).toBe(before);
    });
  });
});

describe("presence", () => {
  it("presence.ping broadcasts identity + tab only, with no state", async () => {
    await withHost(async ({ host, calls }) => {
      const ping = await call(
        host,
        "dashboard.presence.ping",
        { tabSlug: "ops" },
        { operatorId: "operator-a" },
      );
      expect(ping.ok).toBe(true);
      const presence = calls.filter((entry) => entry.event === "boardstate.presence");
      expect(presence).toHaveLength(1);
      const payload = presence[0]!.payload as Record<string, unknown>;
      expect(Object.keys(payload).toSorted()).toEqual(["at", "operator", "tabSlug"]);
      expect(payload).toMatchObject({ operator: "operator-a", tabSlug: "ops" });
      expect(typeof payload.at).toBe("number");
    });
  });
});

describe("private-tab visibility (control-hub)", () => {
  it("enforces private-tab visibility server-side across operators", async () => {
    await withHost(async ({ host }) => {
      await call(
        host,
        "dashboard.tab.create",
        { slug: "team", title: "Team" },
        { operatorId: "operator-a" },
      );
      const createdPrivate = await call(
        host,
        "dashboard.tab.create",
        { slug: "secrets", title: "Secrets", visibility: "private" },
        { operatorId: "operator-a" },
      );
      const createdTabs = createdPrivate.result?.doc.tabs as Array<{
        slug: string;
        owner?: string;
      }>;
      expect(createdTabs.find((tab) => tab.slug === "secrets")).toMatchObject({
        visibility: "private",
        owner: "operator-a",
      });

      const asA = await call(host, "dashboard.workspace.get", {}, { operatorId: "operator-a" });
      const slugsForA = (asA.result!.doc.tabs as Array<{ slug: string }>).map((t) => t.slug);
      expect(slugsForA).toContain("secrets");
      expect(slugsForA).toContain("team");

      const asB = await call(host, "dashboard.workspace.get", {}, { operatorId: "operator-b" });
      const docForB = asB.result?.doc as {
        tabs: Array<{ slug: string }>;
        prefs: { tabOrder: string[] };
      };
      expect(docForB.tabs.map((t) => t.slug)).not.toContain("secrets");
      expect(docForB.tabs.map((t) => t.slug)).toContain("team");
      expect(docForB.prefs.tabOrder).not.toContain("secrets");
      expect(JSON.stringify(asB.result)).not.toContain("secrets");

      // Unidentified operator (no context) is fail-closed out of the private tab.
      const anon = await call(host, "dashboard.workspace.get", {});
      expect((anon.result!.doc.tabs as Array<{ slug: string }>).map((t) => t.slug)).not.toContain(
        "secrets",
      );
    });
  });

  it("does NOT leak a private tab through history.get for a non-owner (I6)", async () => {
    await withHost(async ({ host }) => {
      const created = await call(
        host,
        "dashboard.tab.create",
        { slug: "secrets", title: "Secrets", visibility: "private" },
        { operatorId: "operator-a" },
      );
      const version = created.result?.doc.workspaceVersion as number;
      // Supersede that version with another mutation so it enters the undo ring
      // (history serves superseded snapshots, not the live head).
      await call(host, "dashboard.tab.create", { slug: "public", title: "Public" });

      // operator-b (a non-owner) asks for that exact historical snapshot.
      const snap = await call(
        host,
        "dashboard.workspace.history.get",
        { version },
        { operatorId: "operator-b" },
      );
      expect(snap.ok, JSON.stringify(snap.error)).toBe(true);
      expect((snap.result!.doc.tabs as Array<{ slug: string }>).map((t) => t.slug)).not.toContain(
        "secrets",
      );
      expect(JSON.stringify(snap.result)).not.toContain("secrets");
    });
  });
});

describe("approval gate is store-enforced (I3)", () => {
  it("workspace.replace can NEVER elevate a custom widget to approved", async () => {
    await withHost(async ({ host }) => {
      const before = await call(host, "dashboard.workspace.get", {});
      const doc = structuredClone(before.result?.doc);
      // A caller (agent given write scope, a hostile import, a raw RPC client)
      // submits a doc claiming an APPROVED custom widget with forged provenance.
      doc.tabs[0].widgets.push({
        id: "evil-1",
        kind: "custom:evil",
        grid: { x: 0, y: 40, w: 4, h: 3 },
        collapsed: false,
        hidden: false,
      });
      doc.widgetsRegistry.evil = {
        status: "approved",
        createdBy: "agent:x",
        approvedBy: "user",
        approvedAt: "2020-01-01T00:00:00.000Z",
      };
      const replaced = await call(host, "dashboard.workspace.replace", { doc });
      expect(replaced.ok, JSON.stringify(replaced.error)).toBe(true);
      // The store demotes it: no approval, no forged provenance.
      expect(replaced.result?.doc.widgetsRegistry.evil).toEqual({
        status: "pending",
        createdBy: "agent:x",
      });

      // The ONLY path to approved is the explicit approve RPC.
      const approved = await call(host, "dashboard.widget.approve", {
        name: "evil",
        decision: "approved",
      });
      expect(approved.result?.doc.widgetsRegistry.evil.status).toBe("approved");

      // And a later replace that keeps it approved does NOT demote (already approved).
      const keep = structuredClone(approved.result?.doc);
      const kept = await call(host, "dashboard.workspace.replace", { doc: keep });
      expect(kept.result?.doc.widgetsRegistry.evil.status).toBe("approved");
    });
  });
});

describe("widget write-back", () => {
  it("persists a set and returns it from get; broadcasts id+version WITHOUT the blob", async () => {
    await withHost(async ({ host, calls }) => {
      const empty = await call(host, "dashboard.widget.state.get", { widgetId: "notes-1" });
      expect(empty.result).toEqual({ state: null });

      const blob = { text: "hello", cursor: 5 };
      const set = await call(host, "dashboard.widget.state.set", {
        widgetId: "notes-1",
        state: blob,
      });
      expect(set.ok).toBe(true);
      expect(set.result).toEqual({ widgetId: "notes-1", version: 1 });
      const stateEvents = calls.filter((c) => c.event === "boardstate.widget-state.changed");
      expect(stateEvents.at(-1)?.payload).toEqual({ widgetId: "notes-1", version: 1 });
      const payload = stateEvents.at(-1)?.payload as Record<string, unknown>;
      expect(payload).not.toHaveProperty("state");
      expect(payload).not.toHaveProperty("blob");

      const got = await call(host, "dashboard.widget.state.get", { widgetId: "notes-1" });
      expect(got.result).toMatchObject({ state: blob, version: 1 });

      const set2 = await call(host, "dashboard.widget.state.set", {
        widgetId: "notes-1",
        state: { text: "again" },
      });
      expect(set2.result).toEqual({ widgetId: "notes-1", version: 2 });
    });
  });

  it("state files live under state/, separate from workspace.json", async () => {
    await withHost(async ({ host, stateDir }) => {
      await call(host, "dashboard.widget.state.set", { widgetId: "notes-1", state: { a: 1 } });
      const stateFile = path.join(stateDir, "dashboard", "state", "notes-1.json");
      expect(fsSync.existsSync(stateFile)).toBe(true);
      const workspacePath = path.join(stateDir, "dashboard", "workspace.json");
      const workspaceRaw = fsSync.existsSync(workspacePath)
        ? await fs.readFile(workspacePath, "utf8")
        : "";
      expect(workspaceRaw).not.toContain('"a": 1');
    });
  });

  it("enforces optimistic concurrency via expectedVersion", async () => {
    await withHost(async ({ host }) => {
      const first = await call(host, "dashboard.widget.state.set", {
        widgetId: "notes-1",
        state: { text: "a" },
        expectedVersion: 0,
      });
      expect(first.result).toEqual({ widgetId: "notes-1", version: 1 });

      const stale = await call(host, "dashboard.widget.state.set", {
        widgetId: "notes-1",
        state: { text: "clobber" },
        expectedVersion: 0,
      });
      expect(stale.ok).toBe(false);
      expect(stale.error?.message).toContain("version conflict");
      const get = await call(host, "dashboard.widget.state.get", { widgetId: "notes-1" });
      expect(get.result).toMatchObject({ state: { text: "a" }, version: 1 });

      const second = await call(host, "dashboard.widget.state.set", {
        widgetId: "notes-1",
        state: { text: "b" },
        expectedVersion: 1,
      });
      expect(second.result).toEqual({ widgetId: "notes-1", version: 2 });

      const malformed = await call(host, "dashboard.widget.state.set", {
        widgetId: "notes-1",
        state: { text: "c" },
        expectedVersion: -1,
      });
      expect(malformed.ok).toBe(false);
      expect(malformed.error?.message).toContain("non-negative integer");

      const lww = await call(host, "dashboard.widget.state.set", {
        widgetId: "notes-1",
        state: { text: "d" },
      });
      expect(lww.result).toEqual({ widgetId: "notes-1", version: 3 });
    });
  });

  it("rejects an oversize blob WHOLE (nothing written)", async () => {
    await withHost(async ({ host, stateDir, calls }) => {
      const before = calls.length;
      const big = "x".repeat(70 * 1024);
      const rejected = await call(host, "dashboard.widget.state.set", {
        widgetId: "notes-1",
        state: { text: big },
      });
      expect(rejected.ok).toBe(false);
      expect(rejected.error?.message).toContain("64 KB");
      expect(calls.length).toBe(before);
      const stateFile = path.join(stateDir, "dashboard", "state", "notes-1.json");
      expect(fsSync.existsSync(stateFile)).toBe(false);
    });
  });

  it("rejects widget ids that traverse or use an invalid charset", async () => {
    await withHost(async ({ host, stateDir }) => {
      for (const widgetId of ["../evil", "a/b", "foo.json", "..", "with space", "x".repeat(49)]) {
        const set = await call(host, "dashboard.widget.state.set", { widgetId, state: { x: 1 } });
        expect(set.ok).toBe(false);
        const get = await call(host, "dashboard.widget.state.get", { widgetId });
        expect(get.ok).toBe(false);
      }
      const escaped = path.join(stateDir, "dashboard", "evil.json");
      expect(fsSync.existsSync(escaped)).toBe(false);
    });
  });

  it("rejects unknown params and a missing state field", async () => {
    await withHost(async ({ host }) => {
      const unknown = await call(host, "dashboard.widget.state.set", {
        widgetId: "notes-1",
        state: {},
        extra: true,
      });
      expect(unknown.ok).toBe(false);
      expect(unknown.error?.message).toContain("unexpected param");

      const missing = await call(host, "dashboard.widget.state.set", { widgetId: "notes-1" });
      expect(missing.ok).toBe(false);
      expect(missing.error?.message).toContain("state is required");
    });
  });
});

describe("gallery install method", () => {
  it("installs a client-fetched bundle as pending via dashboard.widget.install", async () => {
    await withHost(async ({ host, store }) => {
      const result = await call(host, "dashboard.widget.install", {
        name: "weather",
        manifest: {
          schemaVersion: 1,
          name: "weather",
          title: "Weather",
          entrypoint: "index.html",
          bindings: [],
          capabilities: ["data:read"],
        },
        files: { "index.html": "<!doctype html><title>Weather</title>" },
      });
      expect(result.ok).toBe(true);
      expect(result.result?.doc.widgetsRegistry.weather).toEqual({
        status: "pending",
        createdBy: "user",
      });
      // The store agrees: install NEVER approves.
      expect((await store.read()).widgetsRegistry.weather?.status).toBe("pending");
    });
  });
});

/** A deterministic subset hash within the schema's TOOLS_HASH_PATTERN alphabet. */
function stubHash(_connector: string, toolIds: readonly string[]): string {
  return `h-${[...toolIds].sort().join(".").replaceAll(":", "-")}`;
}

describe("dashboard.capability.approve — partial tool grants (SPEC §17.1)", () => {
  async function withGrantHost<T>(
    run: (ctx: { host: InProcessHost; store: DashboardStore }) => Promise<T>,
  ): Promise<T> {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "boardstate-cap-"));
    try {
      const storage = new FsStorageAdapter({ storageDir: stateDir });
      const store = new DashboardStore({ storage });
      const host = createInProcessHost(store, storage);
      // Inject a deterministic subset-hash resolver (the real broker wires
      // McpBroker.hashToolSubset) so the granted subset gets its OWN hash. The token
      // stays within the schema's TOOLS_HASH_PATTERN alphabet.
      registerBoardstateRpc(host, {
        store,
        dataRead: { stateDir },
        ...nodeRpcDeps(),
        capabilityToolsHash: stubHash,
      });
      // Seed a `requested` tools grant (as broker registration would).
      await store.mutate(
        (draft) => {
          draft.capabilitiesRegistry = {
            officecli: {
              status: "requested",
              methods: [],
              streams: [],
              tools: ["officecli:read_mail", "officecli:send_mail"],
              toolsHash: stubHash("officecli", ["officecli:read_mail", "officecli:send_mail"]),
            },
          };
        },
        { actor: "system" },
      );
      return await run({ host, store });
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  }

  it("grants only the intersection of the requested set and records the subset's own hash", async () => {
    await withGrantHost(async ({ host, store }) => {
      const res = await call(host, "dashboard.capability.approve", {
        name: "officecli",
        decision: "granted",
        actor: "user",
        // `unlisted:tool` is not in the requested set — it must be dropped.
        tools: ["officecli:read_mail", "unlisted:tool"],
      });
      expect(res.ok).toBe(true);
      const grant = (await store.read()).capabilitiesRegistry!.officecli!;
      expect(grant.status).toBe("granted");
      expect(grant.tools).toEqual(["officecli:read_mail"]);
      expect(grant.toolsHash).toBe(stubHash("officecli", ["officecli:read_mail"]));
      expect(grant.grantedBy).toBe("user");
    });
  });

  it("approve-all (no tools param) grants the full requested set unchanged", async () => {
    await withGrantHost(async ({ host, store }) => {
      await call(host, "dashboard.capability.approve", {
        name: "officecli",
        decision: "granted",
        actor: "user",
      });
      const grant = (await store.read()).capabilitiesRegistry!.officecli!;
      expect(grant.status).toBe("granted");
      expect(grant.tools).toEqual(["officecli:read_mail", "officecli:send_mail"]);
      expect(grant.toolsHash).toBe(
        stubHash("officecli", ["officecli:read_mail", "officecli:send_mail"]),
      );
    });
  });
});
