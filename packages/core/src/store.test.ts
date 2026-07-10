import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { WorkspaceDoc } from "@boardstate/schema";
import { FsStorageAdapter } from "./adapters/storage-fs.js";
import { DashboardStore, reconcileReplaceApproval } from "./store.js";

async function withTempStateDir<T>(run: (stateDir: string) => Promise<T>): Promise<T> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "boardstate-store-"));
  try {
    return await run(stateDir);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
}

function storeAt(stateDir: string, options: { now?: () => number } = {}): DashboardStore {
  return new DashboardStore({
    storage: new FsStorageAdapter({ storageDir: stateDir }),
    ...(options.now ? { now: options.now } : {}),
  });
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("DashboardStore", () => {
  it("seeds workspace.json on first read", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);

      const doc = await store.read();

      expect(doc.tabs[0]).toMatchObject({
        slug: "main",
        title: "Overview",
        createdBy: "system",
      });
      expect(doc.workspaceVersion).toBe(1);
      expect(await readJsonFile(store.workspacePath)).toEqual(doc);
    });
  });

  it("keeps a 20-entry undo ring and restores the newest snapshot", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      await store.read();

      for (let index = 1; index <= 21; index += 1) {
        await store.mutate(
          (draft) => {
            draft.tabs[0]!.title = `Overview ${index}`;
          },
          { actor: "user" },
        );
      }

      const undoFiles = (await fs.readdir(store.undoDir)).toSorted();
      expect(undoFiles).toHaveLength(20);
      const snapshotTitles = await Promise.all(
        undoFiles.map(async (fileName) => {
          const snapshot = (await readJsonFile(path.join(store.undoDir, fileName))) as {
            tabs: Array<{ title: string }>;
          };
          return snapshot.tabs[0]?.title;
        }),
      );
      expect(snapshotTitles).not.toContain("Overview");
      expect(snapshotTitles).toContain("Overview 20");

      const restored = await store.undo();

      expect(restored.tabs[0]?.title).toBe("Overview 20");
      expect(await readJsonFile(store.workspacePath)).toEqual(restored);
    });
  });

  it("lists undo-ring history newest-first as metadata only", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      await store.read();
      for (let index = 1; index <= 3; index += 1) {
        await store.mutate(
          (draft) => {
            draft.tabs[0]!.title = `Overview ${index}`;
          },
          { actor: "user" },
        );
      }

      const history = await store.listHistory();

      // Snapshots represent the pre-mutation versions 1..3, newest-first.
      expect(history.map((entry) => entry.version)).toEqual([3, 2, 1]);
      for (const entry of history) {
        expect(entry.bytes).toBeGreaterThan(0);
        expect(new Date(entry.savedAt).toISOString()).toBe(entry.savedAt);
        // Metadata only — a compact summary is allowed, never a document body.
        expect(
          Object.keys(entry)
            .toSorted()
            .filter((key) => key !== "summary"),
        ).toEqual(["bytes", "savedAt", "version"]);
        expect(entry).not.toHaveProperty("tabs");
        expect(entry).not.toHaveProperty("widgetsRegistry");
      }
    });
  });

  it("summarizes each snapshot against its predecessor; the oldest has none", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      await store.read(); // seed v1 ("Overview")

      // The ring snapshots PRE-mutation states, so three mutations put versions
      // 1..3 in the ring (current = v4). v2 adds a widget; v3 retitles the tab; a
      // third mutation exists only to snapshot v3 into the ring so it can be diffed.
      const addWidget = (id: string) => (draft: WorkspaceDoc) => {
        draft.tabs[0]!.widgets.push({
          id,
          kind: "builtin:markdown",
          title: "Notes",
          grid: { x: 0, y: 0, w: 4, h: 2 },
          collapsed: false,
          hidden: false,
        });
      };
      await store.mutate(addWidget("w1"), { actor: "agent:main" });
      await store.mutate(
        (draft) => {
          draft.tabs[0]!.title = "Home";
        },
        { actor: "user" },
      );
      await store.mutate(addWidget("w2"), { actor: "agent:main" });

      const history = await store.listHistory();
      const byVersion = new Map(history.map((entry) => [entry.version, entry]));

      // v3 snapshot vs its v2 predecessor: one tab retitle. Counts only — the diff
      // has no honest change-author to offer (mutate()'s actor isn't persisted; the
      // tab's createdBy is its CREATOR, not this edit's author).
      expect(byVersion.get(3)?.summary).toMatchObject({
        tabsChanged: 1,
        total: 1,
      });
      expect(byVersion.get(3)?.summary && "actor" in byVersion.get(3)!.summary!).toBe(false);
      // v2 snapshot vs its v1 predecessor: one widget added.
      expect(byVersion.get(2)?.summary).toMatchObject({ added: 1, total: 1 });
      // v1 is the oldest snapshot in the ring — no predecessor to diff against.
      expect(byVersion.get(1)?.summary).toBeUndefined();
    });
  });

  it("returns the exact snapshot doc for a history version", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      await store.read();
      await store.mutate(
        (draft) => {
          draft.tabs[0]!.title = "Renamed";
        },
        { actor: "user" },
      );

      // Version 1 is the seeded doc, snapshotted when version 2 was written.
      const snapshot = await store.getHistorySnapshot(1);
      expect(snapshot.workspaceVersion).toBe(1);
      expect(snapshot.tabs[0]?.title).toBe("Overview");

      await expect(store.getHistorySnapshot(999)).rejects.toThrow("no dashboard history snapshot");
    });
  });

  it("returns an empty history before any mutation", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      await store.read();
      expect(await store.listHistory()).toEqual([]);
    });
  });

  it("rejects oversized mutations without changing the document on disk", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      const before = await store.read();

      await expect(
        store.mutate(
          (draft) => {
            draft.tabs[0]!.widgets[0]!.props = { text: "x".repeat(300_000) };
          },
          { actor: "user" },
        ),
      ).rejects.toThrow("workspace document exceeds 256 KB");

      expect(await readJsonFile(store.workspacePath)).toEqual(before);
      expect(fsSync.existsSync(store.undoDir)).toBe(false);
    });
  });

  it("serializes concurrent mutations through the process mutex", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      await store.read();
      const firstGate = deferred();
      const order: string[] = [];

      const first = store.mutate(
        async (draft) => {
          order.push("first:start");
          await firstGate.promise;
          draft.tabs[0]!.title = "First";
          order.push("first:end");
        },
        { actor: "user" },
      );
      await viWaitFor(() => expect(order).toEqual(["first:start"]));

      const second = store.mutate(
        (draft) => {
          order.push("second");
          draft.tabs[0]!.title = `${draft.tabs[0]!.title} Second`;
        },
        { actor: "user" },
      );

      await Promise.resolve();
      expect(order).toEqual(["first:start"]);
      firstGate.resolve();
      await Promise.all([first, second]);

      expect(order).toEqual(["first:start", "first:end", "second"]);
      expect((await store.read()).tabs[0]?.title).toBe("First Second");
    });
  });

  describe("ephemeral TTL sweep", () => {
    const expiredAt = new Date(1_000).toISOString();

    async function seedEphemeral(stateDir: string): Promise<number> {
      // A writer whose clock predates the expiry adds the widget without sweeping it.
      const writer = storeAt(stateDir, { now: () => 500 });
      const result = await writer.mutate(
        (draft) => {
          draft.tabs[0]!.widgets.push({
            id: "living-answer",
            kind: "builtin:markdown",
            grid: { x: 0, y: 40, w: 4, h: 2 },
            collapsed: false,
            hidden: false,
            ephemeral: { expiresAt: expiredAt },
          });
        },
        { actor: "user" },
      );
      return result.doc.workspaceVersion;
    }

    it("removes expired ephemeral widgets on read, bumps version, and persists once", async () => {
      await withTempStateDir(async (stateDir) => {
        const seededVersion = await seedEphemeral(stateDir);

        // A reader past the expiry sweeps the widget on read.
        const reader = storeAt(stateDir, { now: () => 2_000 });
        const doc = await reader.read();

        expect(doc.tabs[0]!.widgets.some((w) => w.id === "living-answer")).toBe(false);
        expect(doc.tabs[0]!.widgets.some((w) => w.id === "cost-today")).toBe(true);
        expect(doc.workspaceVersion).toBe(seededVersion + 1);
        // The sweep persisted exactly the returned doc (one atomic write).
        expect(await readJsonFile(reader.workspacePath)).toEqual(doc);
      });
    });

    it("keeps unexpired ephemeral widgets and does not rewrite the doc", async () => {
      await withTempStateDir(async (stateDir) => {
        const seededVersion = await seedEphemeral(stateDir);

        // A reader before the expiry leaves the widget and the version untouched.
        const reader = storeAt(stateDir, { now: () => 800 });
        const doc = await reader.read();

        expect(doc.tabs[0]!.widgets.some((w) => w.id === "living-answer")).toBe(true);
        expect(doc.workspaceVersion).toBe(seededVersion);
      });
    });

    it("treats an expiry at exactly now as expired", async () => {
      await withTempStateDir(async (stateDir) => {
        await seedEphemeral(stateDir);
        const reader = storeAt(stateDir, { now: () => 1_000 });
        const doc = await reader.read();
        expect(doc.tabs[0]!.widgets.some((w) => w.id === "living-answer")).toBe(false);
      });
    });
  });

  describe("grant TTL sweep (SPEC §17 grant TTLs, #64)", () => {
    async function seedGrant(stateDir: string): Promise<number> {
      // `replace` is the trusted seeding primitive (no re-pend); the granted lease has an
      // expiresAt at t=1000 and carries an autoConfirm the sweep must also clear.
      const writer = storeAt(stateDir, { now: () => 500 });
      const doc = await writer.read();
      doc.capabilitiesRegistry = {
        officecli: {
          status: "granted",
          methods: [],
          streams: [],
          tools: ["officecli:send_mail"],
          toolsHash: "hash-send",
          autoConfirm: ["officecli:send_mail"],
          expiresAt: new Date(1_000).toISOString(),
          agents: ["agent:alice"],
          grantedBy: "user",
          grantedAt: new Date(500).toISOString(),
        },
      };
      const result = await writer.replace(doc, { actor: "user" });
      return result.doc.workspaceVersion;
    }

    it("re-pends a lapsed grant on read — clears autoConfirm + expiresAt + agents, bumps version once", async () => {
      await withTempStateDir(async (stateDir) => {
        const seededVersion = await seedGrant(stateDir);
        const reader = storeAt(stateDir, { now: () => 2_000 });
        const doc = await reader.read();
        const grant = doc.capabilitiesRegistry!.officecli!;
        expect(grant.status).toBe("requested");
        expect(grant.autoConfirm).toBeUndefined();
        expect(grant.expiresAt).toBeUndefined();
        expect(grant.agents).toBeUndefined();
        expect(grant.grantedBy).toBeUndefined();
        // Tools survive (the operator re-approves the SAME surface); version bumped once.
        expect(grant.tools).toEqual(["officecli:send_mail"]);
        expect(doc.workspaceVersion).toBe(seededVersion + 1);
        expect(await readJsonFile(reader.workspacePath)).toEqual(doc);
      });
    });

    it("keeps a live (unexpired) grant untouched and does not rewrite the doc", async () => {
      await withTempStateDir(async (stateDir) => {
        const seededVersion = await seedGrant(stateDir);
        const reader = storeAt(stateDir, { now: () => 800 });
        const doc = await reader.read();
        expect(doc.capabilitiesRegistry!.officecli!.status).toBe("granted");
        expect(doc.workspaceVersion).toBe(seededVersion);
      });
    });
  });

  describe("widget state (write-back)", () => {
    it("persists a blob and reads it back with an incrementing version", async () => {
      await withTempStateDir(async (stateDir) => {
        const store = storeAt(stateDir);
        expect(await store.readWidgetState("cost-today")).toBeNull();

        const first = await store.writeWidgetState("cost-today", { count: 1 });
        expect(first.version).toBe(1);
        const record = await store.readWidgetState("cost-today");
        expect(record).toMatchObject({ version: 1, blob: { count: 1 } });
        expect(typeof record?.updatedAt).toBe("string");

        const second = await store.writeWidgetState("cost-today", { count: 2 });
        expect(second.version).toBe(2);
        expect((await store.readWidgetState("cost-today"))?.blob).toEqual({ count: 2 });
      });
    });

    it("rejects an oversized blob without writing anything", async () => {
      await withTempStateDir(async (stateDir) => {
        const store = storeAt(stateDir);
        await expect(
          store.writeWidgetState("cost-today", { text: "x".repeat(70_000) }),
        ).rejects.toThrow("widget state exceeds 64 KB");
        expect(await store.readWidgetState("cost-today")).toBeNull();
      });
    });

    it("enforces optimistic concurrency via expectedVersion", async () => {
      await withTempStateDir(async (stateDir) => {
        const store = storeAt(stateDir);
        await store.writeWidgetState("cost-today", { v: 1 });
        await expect(
          store.writeWidgetState("cost-today", { v: 2 }, { expectedVersion: 0 }),
        ).rejects.toThrow("version conflict");
        // The correct expected version proceeds.
        const ok = await store.writeWidgetState("cost-today", { v: 2 }, { expectedVersion: 1 });
        expect(ok.version).toBe(2);
      });
    });

    it("rejects a widget id that escapes the state jail", async () => {
      await withTempStateDir(async (stateDir) => {
        const store = storeAt(stateDir);
        await expect(store.writeWidgetState("../evil", null)).rejects.toThrow(
          "widget id is invalid",
        );
        await expect(store.readWidgetState("a/b")).rejects.toThrow("widget id is invalid");
      });
    });
  });
});

describe("replaceSanitized (approval gate, SPEC §8.2)", () => {
  it("cannot elevate a widget to approved, but preserves an already-approved one", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      // Trusted seed: establish an approved widget via the raw primitive.
      const seed = await store.read();
      seed.widgetsRegistry.trusted = {
        status: "approved",
        createdBy: "user",
        approvedBy: "user",
        approvedAt: "2026-01-01T00:00:00.000Z",
      };
      await store.replace(seed, { actor: "user" });

      // Untrusted replace: keep `trusted` approved (legit) AND smuggle a NEW approved.
      const doc = structuredClone(await store.read());
      doc.widgetsRegistry.smuggled = {
        status: "approved",
        createdBy: "agent:x",
        approvedBy: "user",
        approvedAt: "2020-01-01T00:00:00.000Z",
      };
      const result = await store.replaceSanitized(doc, { actor: "agent:x" });

      // Already-approved survives; the smuggled elevation is forced to pending.
      expect(result.doc.widgetsRegistry.trusted?.status).toBe("approved");
      expect(result.doc.widgetsRegistry.smuggled).toEqual({
        status: "pending",
        createdBy: "agent:x",
      });
    });
  });

  it("re-pends a granted tools grant whose tools/toolsHash is mutated (SPEC §17.1)", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      const seed = await store.read();
      seed.capabilitiesRegistry = {
        officecli: {
          status: "granted",
          methods: [],
          streams: [],
          tools: ["officecli:read_mail"],
          toolsHash: "hash-read",
          grantedBy: "user",
          grantedAt: "2026-01-01T00:00:00.000Z",
        },
      };
      await store.replace(seed, { actor: "user" });

      // A) appending a tool id to a still-granted grant re-pends it.
      const widen = structuredClone(await store.read());
      widen.capabilitiesRegistry!.officecli!.tools = ["officecli:read_mail", "officecli:send_mail"];
      const widened = await store.replaceSanitized(widen, { actor: "agent:x" });
      expect(widened.doc.capabilitiesRegistry!.officecli!.status).toBe("requested");
      expect(widened.doc.capabilitiesRegistry!.officecli!.grantedBy).toBeUndefined();

      // Re-grant, then B) swapping only the hash (rug-pull digest) also re-pends.
      const regrant = structuredClone(widened.doc);
      regrant.capabilitiesRegistry!.officecli = {
        status: "granted",
        methods: [],
        streams: [],
        tools: ["officecli:read_mail"],
        toolsHash: "hash-read",
        grantedBy: "user",
        grantedAt: "2026-01-02T00:00:00.000Z",
      };
      await store.replace(regrant, { actor: "user" });
      const swap = structuredClone(await store.read());
      swap.capabilitiesRegistry!.officecli!.toolsHash = "hash-tampered";
      const swapped = await store.replaceSanitized(swap, { actor: "agent:x" });
      expect(swapped.doc.capabilitiesRegistry!.officecli!.status).toBe("requested");

      // An UNCHANGED granted grant survives a replace untouched (no false re-pend).
      const regrant2 = structuredClone(swapped.doc);
      regrant2.capabilitiesRegistry!.officecli = {
        status: "granted",
        methods: [],
        streams: [],
        tools: ["officecli:read_mail"],
        toolsHash: "hash-read",
        grantedBy: "user",
        grantedAt: "2026-01-03T00:00:00.000Z",
      };
      await store.replace(regrant2, { actor: "user" });
      const noop = await store.replaceSanitized(structuredClone(await store.read()), {
        actor: "agent:x",
      });
      expect(noop.doc.capabilitiesRegistry!.officecli!.status).toBe("granted");
    });
  });

  it("re-pends a granted grant whose autoConfirm or expiresAt is mutated via replace (#62/#64)", async () => {
    await withTempStateDir(async (stateDir) => {
      const store = storeAt(stateDir);
      const seed = await store.read();
      seed.capabilitiesRegistry = {
        officecli: {
          status: "granted",
          methods: [],
          streams: [],
          tools: ["officecli:send_mail"],
          toolsHash: "hash-send",
          grantedBy: "user",
          grantedAt: "2026-01-01T00:00:00.000Z",
        },
      };
      await store.replace(seed, { actor: "user" });

      // A) an agent injecting autoConfirm onto a granted grant (no tools/hash change) re-pends.
      const inject = structuredClone(await store.read());
      inject.capabilitiesRegistry!.officecli!.autoConfirm = ["officecli:send_mail"];
      const injected = await store.replaceSanitized(inject, { actor: "agent:x" });
      expect(injected.doc.capabilitiesRegistry!.officecli!.status).toBe("requested");
      expect(injected.doc.capabilitiesRegistry!.officecli!.autoConfirm).toBeUndefined();
      expect(injected.doc.capabilitiesRegistry!.officecli!.grantedBy).toBeUndefined();

      // Re-grant with a FUTURE TTL (so the store's real clock does not sweep it), then
      // B) an agent EXTENDING that TTL on a granted grant re-pends + strips it.
      const regrant = structuredClone(injected.doc);
      regrant.capabilitiesRegistry!.officecli = {
        status: "granted",
        methods: [],
        streams: [],
        tools: ["officecli:send_mail"],
        toolsHash: "hash-send",
        expiresAt: "2099-01-05T00:00:00.000Z",
        grantedBy: "user",
        grantedAt: "2026-01-02T00:00:00.000Z",
      };
      await store.replace(regrant, { actor: "user" });
      const extend = structuredClone(await store.read());
      extend.capabilitiesRegistry!.officecli!.expiresAt = "2099-12-31T00:00:00.000Z";
      const extended = await store.replaceSanitized(extend, { actor: "agent:x" });
      expect(extended.doc.capabilitiesRegistry!.officecli!.status).toBe("requested");
      expect(extended.doc.capabilitiesRegistry!.officecli!.expiresAt).toBeUndefined();
    });
  });

  it("re-pends a same-length surface SWAP even when current tools hold a duplicate", () => {
    // Adversarial verify 2026-07-10: sameStringSet compared length + one-way
    // membership, so a granted grant whose current tools were ["x","x"] would NOT
    // re-pend when swapped to ["x","y"] (same length, x ∈ {x}). Hand-built docs
    // bypass schema (which now also rejects dup ids) to test the gate standalone.
    const current = {
      capabilitiesRegistry: {
        officecli: {
          status: "granted",
          methods: [],
          streams: [],
          tools: ["officecli:read_mail", "officecli:read_mail"],
          toolsHash: "hash-x",
          grantedBy: "user",
        },
      },
    } as never;
    const incoming = {
      capabilitiesRegistry: {
        officecli: {
          status: "granted",
          methods: [],
          streams: [],
          tools: ["officecli:read_mail", "officecli:send_mail"],
          toolsHash: "hash-x",
          grantedBy: "user",
        },
      },
    } as never;
    const out = reconcileReplaceApproval(incoming, current);
    expect(out.capabilitiesRegistry!.officecli!.status).toBe("requested");
    expect(out.capabilitiesRegistry!.officecli!.grantedBy).toBeUndefined();
  });

  it("re-pends + strips a granted grant whose per-agent scope drifts via replace (SPEC §17.3, #59)", () => {
    // Both a WIDEN (dropping the scope entirely) and a re-scope are silent widenings
    // through the agent path — the single reconcile gate re-pends and strips `agents`.
    const grant = (agents: string[] | undefined) => ({
      capabilitiesRegistry: {
        officecli: {
          status: "granted",
          methods: [],
          streams: [],
          tools: ["officecli:read_mail"],
          toolsHash: "hash-x",
          grantedBy: "user",
          ...(agents ? { agents } : {}),
        },
      },
    });
    // A) dropping the scope (scoped -> all agents) re-pends.
    const widened = reconcileReplaceApproval(
      grant(undefined) as never,
      grant(["agent:alice"]) as never,
    );
    expect(widened.capabilitiesRegistry!.officecli!.status).toBe("requested");
    expect(widened.capabilitiesRegistry!.officecli!.grantedBy).toBeUndefined();
    // B) re-scoping to a different agent re-pends + strips.
    const rescoped = reconcileReplaceApproval(
      grant(["agent:bob"]) as never,
      grant(["agent:alice"]) as never,
    );
    expect(rescoped.capabilitiesRegistry!.officecli!.status).toBe("requested");
    expect(rescoped.capabilitiesRegistry!.officecli!.agents).toBeUndefined();
    // An UNCHANGED scope survives untouched (no false re-pend).
    const noop = reconcileReplaceApproval(
      grant(["agent:alice"]) as never,
      grant(["agent:alice"]) as never,
    );
    expect(noop.capabilitiesRegistry!.officecli!.status).toBe("granted");
    expect(noop.capabilitiesRegistry!.officecli!.agents).toEqual(["agent:alice"]);
  });
});

async function viWaitFor(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 1000;
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() > deadline) {
        throw error;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
    }
  }
}
