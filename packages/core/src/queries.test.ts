import { describe, expect, it } from "vitest";
import type { DashboardTab } from "./types.js";
import {
  applyPointer,
  groupTabsByActor,
  hiddenTabs,
  normalizeWorkspace,
  orderedTabs,
  resolveActiveSlug,
  visibleTabs,
} from "./queries.js";

const sampleDoc = {
  schemaVersion: 1,
  workspaceVersion: 3,
  tabs: [
    {
      slug: "main",
      title: "Main",
      hidden: false,
      widgets: [
        {
          id: "w1",
          kind: "builtin:stat-card",
          title: "Revenue",
          grid: { x: 0, y: 0, w: 4, h: 2 },
          collapsed: false,
          createdBy: "agent:finance",
        },
      ],
    },
    { slug: "archive", title: "Archive", hidden: true, widgets: [] },
  ],
  prefs: { tabOrder: ["archive", "main"] },
};

describe("normalizeWorkspace", () => {
  it("normalizes tabs, widgets, and prefs defensively", () => {
    const ws = normalizeWorkspace(sampleDoc);
    expect(ws.workspaceVersion).toBe(3);
    expect(ws.tabs).toHaveLength(2);
    expect(ws.tabs[0]!.widgets[0]!.grid).toEqual({ x: 0, y: 0, w: 4, h: 2 });
    expect(ws.prefs.tabOrder).toEqual(["archive", "main"]);
  });

  it("drops malformed tabs and widgets", () => {
    const ws = normalizeWorkspace({
      tabs: [{ title: "no slug" }, { slug: "ok", widgets: [{ kind: "x" }, { id: "y" }] }],
    });
    expect(ws.tabs).toHaveLength(1);
    expect(ws.tabs[0]!.slug).toBe("ok");
    expect(ws.tabs[0]!.widgets).toHaveLength(0);
  });

  it("clamps out-of-range grid coordinates", () => {
    const ws = normalizeWorkspace({
      tabs: [
        {
          slug: "t",
          widgets: [{ id: "w", kind: "k", grid: { x: 20, y: -5, w: 99, h: 0 } }],
        },
      ],
    });
    expect(ws.tabs[0]!.widgets[0]!.grid).toEqual({ x: 0, y: 0, w: 12, h: 1 });
  });

  it("carries a well-formed ephemeral marker and drops a malformed one", () => {
    const ws = normalizeWorkspace({
      tabs: [
        {
          slug: "t",
          widgets: [
            {
              id: "keep",
              kind: "k",
              grid: { x: 0, y: 0, w: 2, h: 2 },
              ephemeral: { expiresAt: "2026-07-09T12:00:00Z" },
            },
            {
              id: "drop",
              kind: "k",
              grid: { x: 2, y: 0, w: 2, h: 2 },
              ephemeral: { expiresAt: 42 },
            },
          ],
        },
      ],
    });
    expect(ws.tabs[0]!.widgets[0]!.ephemeral).toEqual({ expiresAt: "2026-07-09T12:00:00Z" });
    expect(ws.tabs[0]!.widgets[1]!.ephemeral).toBeUndefined();
  });

  it("preserves a valid tab layout and drops an invalid one", () => {
    const ws = normalizeWorkspace({
      tabs: [
        { slug: "a", widgets: [], layout: "full" },
        { slug: "b", widgets: [], layout: "grid" },
        { slug: "c", widgets: [], layout: "fullscreen" },
      ],
    });
    expect(ws.tabs[0]!.layout).toBe("full");
    expect(ws.tabs[1]!.layout).toBe("grid");
    expect(ws.tabs[2]!.layout).toBeUndefined();
  });

  it("preserves a private visibility marker and owner, dropping non-private visibility", () => {
    const ws = normalizeWorkspace({
      tabs: [
        { slug: "a", widgets: [], visibility: "private", owner: "device:a" },
        { slug: "b", widgets: [], visibility: "shared" },
      ],
    });
    expect(ws.tabs[0]!.visibility).toBe("private");
    expect(ws.tabs[0]!.owner).toBe("device:a");
    expect(ws.tabs[1]!.visibility).toBeUndefined();
  });
});

describe("groupTabsByActor", () => {
  const tab = (slug: string, createdBy?: string): DashboardTab => ({
    slug,
    title: slug,
    hidden: false,
    widgets: [],
    ...(createdBy ? { createdBy } : {}),
  });

  it("buckets tabs by user / system / agent provenance in first-seen order", () => {
    const groups = groupTabsByActor([
      tab("me"),
      tab("sys", "system"),
      tab("fin1", "agent:finance"),
      tab("fin2", "agent:finance"),
      tab("ops", "agent:ops"),
      tab("me2", "user"),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["user", "system", "agent:finance", "agent:ops"]);
    const finance = groups.find((g) => g.key === "agent:finance")!;
    expect(finance.kind).toBe("agent");
    expect(finance.agentId).toBe("finance");
    expect(finance.tabs.map((t) => t.slug)).toEqual(["fin1", "fin2"]);
    expect(groups.find((g) => g.key === "user")!.tabs.map((t) => t.slug)).toEqual(["me", "me2"]);
  });

  it("treats an unstamped tab as a user tab", () => {
    const groups = groupTabsByActor([tab("solo")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "user", kind: "user", agentId: null });
  });
});

describe("tab ordering + resolution", () => {
  it("honors prefs.tabOrder then appends unordered tabs", () => {
    const ws = normalizeWorkspace({
      ...sampleDoc,
      prefs: { tabOrder: ["main"] },
    });
    expect(orderedTabs(ws).map((t) => t.slug)).toEqual(["main", "archive"]);
  });

  it("splits visible and hidden tabs", () => {
    const ws = normalizeWorkspace(sampleDoc);
    expect(visibleTabs(ws).map((t) => t.slug)).toEqual(["main"]);
    expect(hiddenTabs(ws).map((t) => t.slug)).toEqual(["archive"]);
  });

  it("resolves requested slug, falling back to first visible tab", () => {
    const ws = normalizeWorkspace(sampleDoc);
    expect(resolveActiveSlug(ws, "main")).toBe("main");
    expect(resolveActiveSlug(ws, "archive")).toBe("archive");
    expect(resolveActiveSlug(ws, "missing")).toBe("main");
    expect(resolveActiveSlug(ws, null)).toBe("main");
  });
});

describe("applyPointer", () => {
  it("walks objects and arrays, returning undefined for misses", () => {
    const doc = { a: { b: [10, 20] } };
    expect(applyPointer(doc, "/a/b/1")).toBe(20);
    expect(applyPointer(doc, "/a/missing")).toBeUndefined();
    expect(applyPointer(doc, undefined)).toBe(doc);
  });

  it("decodes escaped pointer segments", () => {
    expect(applyPointer({ "a/b": 5 }, "/a~1b")).toBe(5);
    expect(applyPointer({ "a~b": 6 }, "/a~0b")).toBe(6);
  });
});
