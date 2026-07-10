import { describe, expect, it } from "vitest";
import {
  computeWorkspaceDiff,
  firstSeenVersion,
  groupDiffByActor,
  summarizeWorkspaceDiff,
  type DashboardDiffEntry,
  type DashboardHistorySnapshot,
} from "./history-client.js";
import { normalizeWorkspace } from "./queries.js";
import type { DashboardWidget, DashboardWorkspace } from "./types.js";

function widget(overrides: Partial<DashboardWidget> & { id: string }): DashboardWidget {
  return {
    kind: "builtin:markdown",
    title: overrides.id,
    grid: { x: 0, y: 0, w: 4, h: 2 },
    collapsed: false,
    ...overrides,
  };
}

function workspace(version: number, tabs: DashboardWorkspace["tabs"]): DashboardWorkspace {
  return normalizeWorkspace({
    schemaVersion: 1,
    workspaceVersion: version,
    tabs,
    prefs: { tabOrder: tabs.map((tab) => tab.slug) },
    widgetsRegistry: {},
  });
}

describe("computeWorkspaceDiff", () => {
  it("reports added, removed, moved, and retitled widgets grouped by actor", () => {
    const snapshot = workspace(3, [
      {
        slug: "main",
        title: "Main",
        hidden: false,
        createdBy: "system",
        widgets: [
          widget({ id: "a", title: "Alpha", createdBy: "agent:main" }),
          widget({ id: "b", title: "Bravo", grid: { x: 4, y: 0, w: 4, h: 2 }, createdBy: "user" }),
        ],
      },
      { slug: "ops", title: "Ops", hidden: false, createdBy: "agent:main", widgets: [] },
    ]);
    const current = workspace(6, [
      {
        slug: "main",
        title: "Main",
        hidden: false,
        createdBy: "system",
        widgets: [
          widget({ id: "a", title: "Alpha 2", createdBy: "agent:main" }),
          widget({ id: "c", title: "Charlie", createdBy: "agent:main" }),
        ],
      },
      {
        slug: "ops",
        title: "Operations",
        hidden: false,
        createdBy: "agent:main",
        widgets: [
          widget({ id: "b", title: "Bravo", grid: { x: 4, y: 0, w: 4, h: 2 }, createdBy: "user" }),
        ],
      },
    ]);

    const diff = computeWorkspaceDiff(snapshot, current);
    const kinds = diff.map((entry) => `${entry.kind}:${entry.id}`);
    expect(kinds).toContain("tab-retitled:ops");
    expect(kinds).toContain("widget-added:c");
    expect(kinds).toContain("widget-retitled:a");
    expect(kinds).toContain("widget-moved:b");
    const moved = diff.find((entry) => entry.kind === "widget-moved" && entry.id === "b");
    expect(moved?.detail).toBe("main → ops");

    const grouped = groupDiffByActor(diff);
    const agentGroup = grouped.find((group) => group.actor === "agent:main");
    expect(agentGroup?.entries.some((entry) => entry.id === "c")).toBe(true);
  });

  it("reports removed widgets and added/removed tabs", () => {
    const snapshot = workspace(2, [
      {
        slug: "main",
        title: "Main",
        hidden: false,
        createdBy: "system",
        widgets: [widget({ id: "a", createdBy: "user" })],
      },
    ]);
    const current = workspace(4, [
      { slug: "main", title: "Main", hidden: false, createdBy: "system", widgets: [] },
      { slug: "extra", title: "Extra", hidden: false, createdBy: "agent:main", widgets: [] },
    ]);
    const diff = computeWorkspaceDiff(snapshot, current);
    expect(diff.map((entry) => `${entry.kind}:${entry.id}`)).toEqual(
      expect.arrayContaining(["tab-added:extra", "widget-removed:a"]),
    );
  });
});

describe("firstSeenVersion", () => {
  const snapAt = (version: number, ids: string[]): DashboardHistorySnapshot => ({
    version,
    workspace: workspace(version, [
      {
        slug: "main",
        title: "Main",
        hidden: false,
        createdBy: "system",
        widgets: ids.map((id) => widget({ id })),
      },
    ]),
  });

  it("returns the earliest version that contains the widget when an older snapshot lacks it", () => {
    const snapshots = [snapAt(1, ["a"]), snapAt(2, ["a", "b"]), snapAt(3, ["a", "b"])];
    expect(firstSeenVersion("b", snapshots)).toBe(2);
  });

  it("returns undefined when the widget is in the oldest loaded snapshot (predates the ring)", () => {
    const snapshots = [snapAt(1, ["a"]), snapAt(2, ["a"])];
    expect(firstSeenVersion("a", snapshots)).toBeUndefined();
  });

  it("returns undefined when no snapshots are loaded", () => {
    expect(firstSeenVersion("a", [])).toBeUndefined();
  });
});

describe("summarizeWorkspaceDiff", () => {
  const entry = (kind: DashboardDiffEntry["kind"], actor: string | null): DashboardDiffEntry => ({
    kind,
    actor,
    id: "x",
    label: "X",
  });

  it("partitions the changelist into per-kind counts summing to total", () => {
    const summary = summarizeWorkspaceDiff([
      entry("widget-added", "agent:main"),
      entry("widget-added", "agent:main"),
      entry("widget-removed", "user"),
      entry("widget-moved", "agent:main"),
      entry("widget-retitled", "user"),
      entry("tab-added", "user"),
      entry("tab-retitled", "user"),
    ]);
    expect(summary).toEqual({
      added: 2,
      removed: 1,
      moved: 1,
      retitled: 1,
      tabsChanged: 2,
      total: 7,
    });
  });

  it("carries NO actor field — creator provenance must not masquerade as change authorship", () => {
    // Adversarial verify 2026-07-11: the only actor available to the diff is the touched
    // item's `createdBy` (its CREATOR); rendering that under "what changed" mislabeled a
    // human edit to a system-created tab as "system". Counts only until the ring stores
    // a real per-save author.
    const summary = summarizeWorkspaceDiff([
      entry("widget-added", "agent:main"),
      entry("widget-removed", "user"),
    ]);
    expect("actor" in summary).toBe(false);
  });

  it("reports an all-zero summary for an empty changelist", () => {
    expect(summarizeWorkspaceDiff([])).toEqual({
      added: 0,
      removed: 0,
      moved: 0,
      retitled: 0,
      tabsChanged: 0,
      total: 0,
    });
  });
});
