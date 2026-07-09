import { describe, expect, it } from "vitest";
import type {
  DashboardTab,
  DashboardWidget,
  DashboardWidgetRegistryEntry,
  WorkspaceDoc,
} from "@boardstate/schema";
import { reviewWorkspace, WORKSPACE_REVIEW_RULES } from "./review.js";

// --- Fixture builders ------------------------------------------------------

function widget(id: string, kind: string, extra: Partial<DashboardWidget> = {}): DashboardWidget {
  return {
    id,
    kind,
    grid: { x: 0, y: 0, w: 4, h: 2 },
    collapsed: false,
    hidden: false,
    ...extra,
  };
}

function tab(
  slug: string,
  widgets: DashboardWidget[],
  extra: Partial<DashboardTab> = {},
): DashboardTab {
  return { slug, title: slug, hidden: false, createdBy: "user", widgets, ...extra };
}

function doc(
  tabs: DashboardTab[],
  widgetsRegistry: Record<string, DashboardWidgetRegistryEntry> = {},
): WorkspaceDoc {
  return {
    schemaVersion: 1,
    workspaceVersion: 1,
    tabs,
    widgetsRegistry,
    prefs: { tabOrder: tabs.map((t) => t.slug) },
  };
}

function statCard(id: string, y: number, extra: Partial<DashboardWidget> = {}): DashboardWidget {
  return widget(id, "builtin:stat-card", { grid: { x: 0, y, w: 4, h: 2 }, title: id, ...extra });
}

// --- One test per rule -----------------------------------------------------

describe("reviewWorkspace rules", () => {
  it("exposes the 12 rule codes", () => {
    expect(WORKSPACE_REVIEW_RULES).toHaveLength(12);
  });

  it("tab-overcrowded: more than ten widgets on a tab", () => {
    const widgets = Array.from({ length: 11 }, (_, i) => widget(`w${i}`, "builtin:stat-card"));
    const findings = reviewWorkspace(doc([tab("busy", widgets)]));
    const finding = findings.find((f) => f.code === "tab-overcrowded");
    expect(finding).toMatchObject({ code: "tab-overcrowded", severity: "warn", tab: "busy" });
    expect(finding?.widgetId).toBeUndefined();
  });

  it("tab-empty: a visible tab with no widgets", () => {
    const findings = reviewWorkspace(doc([tab("blank", [])]));
    expect(findings).toEqual([
      expect.objectContaining({ code: "tab-empty", severity: "info", tab: "blank" }),
    ]);
    const hidden = reviewWorkspace(doc([tab("blank", [], { hidden: true })]));
    expect(hidden).toEqual([]);
  });

  it("numbers-not-leading: a chart leads while stat cards sit lower", () => {
    const widgets = [
      widget("chart", "builtin:chart", { title: "Trend", grid: { x: 0, y: 0, w: 4, h: 3 } }),
      statCard("stat", 3),
    ];
    const findings = reviewWorkspace(doc([tab("overview", widgets)]));
    const finding = findings.find((f) => f.code === "numbers-not-leading");
    expect(finding).toMatchObject({
      code: "numbers-not-leading",
      severity: "warn",
      tab: "overview",
    });
  });

  it("chart-untitled: a chart with no title", () => {
    const findings = reviewWorkspace(doc([tab("overview", [widget("c1", "builtin:chart")])]));
    expect(findings).toEqual([
      expect.objectContaining({
        code: "chart-untitled",
        severity: "info",
        tab: "overview",
        widgetId: "c1",
      }),
    ]);
  });

  it("tab-source-named: a slug named after the data source", () => {
    const findings = reviewWorkspace(doc([tab("data", [widget("w0", "builtin:markdown")])]));
    expect(findings).toEqual([
      expect.objectContaining({ code: "tab-source-named", severity: "info", tab: "data" }),
    ]);
  });

  it("tab-needs-context: four data widgets and no prose", () => {
    const widgets = [
      widget("a", "builtin:stat-card"),
      widget("b", "builtin:sessions"),
      widget("c", "builtin:usage"),
      widget("d", "builtin:activity"),
    ];
    const findings = reviewWorkspace(doc([tab("overview", widgets)]));
    const finding = findings.find((f) => f.code === "tab-needs-context");
    expect(finding).toMatchObject({ code: "tab-needs-context", severity: "info", tab: "overview" });
  });

  it("ephemeral-leftover: a widget expired before now", () => {
    const expired = widget("eph", "builtin:stat-card", {
      title: "Answer",
      ephemeral: { expiresAt: "2020-01-01T00:00:00.000Z" },
    });
    const findings = reviewWorkspace(doc([tab("overview", [expired])]));
    expect(findings).toEqual([
      expect.objectContaining({
        code: "ephemeral-leftover",
        severity: "warn",
        tab: "overview",
        widgetId: "eph",
      }),
    ]);
  });

  it("widget-oversized: a tall widget crowding three neighbors", () => {
    const widgets = [
      widget("big", "builtin:table", { title: "Rows", grid: { x: 0, y: 0, w: 12, h: 9 } }),
      widget("n1", "builtin:markdown", { title: "One" }),
      widget("n2", "builtin:markdown", { title: "Two" }),
      widget("n3", "builtin:markdown", { title: "Three" }),
    ];
    const findings = reviewWorkspace(doc([tab("overview", widgets)]));
    const finding = findings.find((f) => f.code === "widget-oversized");
    expect(finding).toMatchObject({
      code: "widget-oversized",
      severity: "warn",
      tab: "overview",
      widgetId: "big",
    });
  });

  it("title-duplicate: two widgets share a title on the same tab", () => {
    const widgets = [
      widget("first", "builtin:stat-card", { title: "Revenue" }),
      widget("second", "builtin:stat-card", { title: "Revenue" }),
    ];
    const findings = reviewWorkspace(doc([tab("overview", widgets)]));
    const dupes = findings.filter((f) => f.code === "title-duplicate");
    expect(dupes).toEqual([
      expect.objectContaining({
        code: "title-duplicate",
        severity: "info",
        tab: "overview",
        widgetId: "second",
      }),
    ]);
  });

  it("chart-sparse: a chart with fewer than three static points", () => {
    const sparse = widget("spark", "builtin:chart", {
      title: "Trend",
      bindings: { value: { source: "static", value: [1, 2] } },
    });
    const findings = reviewWorkspace(doc([tab("overview", [sparse])]));
    expect(findings).toEqual([
      expect.objectContaining({
        code: "chart-sparse",
        severity: "info",
        tab: "overview",
        widgetId: "spark",
      }),
    ]);
  });

  it("table-unbounded: many rows and no limit", () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({ n: i }));
    const table = widget("t", "builtin:table", { title: "Big", props: { rows } });
    const findings = reviewWorkspace(doc([tab("overview", [table])]));
    expect(findings).toEqual([
      expect.objectContaining({
        code: "table-unbounded",
        severity: "info",
        tab: "overview",
        widgetId: "t",
      }),
    ]);
    // A declared limit clears the finding.
    const bounded = widget("t", "builtin:table", { title: "Big", props: { rows, limit: 5 } });
    expect(reviewWorkspace(doc([tab("overview", [bounded])]))).toEqual([]);
  });

  it("registry-orphan: a registered widget no tab uses", () => {
    const registry: Record<string, DashboardWidgetRegistryEntry> = {
      "burndown-chart": { status: "approved", createdBy: "agent:planner" },
    };
    const findings = reviewWorkspace(doc([tab("overview", [])], registry));
    const finding = findings.find((f) => f.code === "registry-orphan");
    expect(finding).toMatchObject({ code: "registry-orphan", severity: "warn" });
    expect(finding?.tab).toBeUndefined();
    expect(finding?.widgetId).toBeUndefined();
    // A tab actually using the custom widget clears the orphan finding.
    const used = reviewWorkspace(
      doc(
        [tab("overview", [widget("bd", "custom:burndown-chart", { title: "Burndown" })])],
        registry,
      ),
    );
    expect(used.some((f) => f.code === "registry-orphan")).toBe(false);
  });
});

// --- Clean doc, ordering, and injectable now -------------------------------

describe("reviewWorkspace whole-doc behavior", () => {
  it("returns no findings for a well-formed workspace", () => {
    const clean = doc([
      tab("overview", [
        widget("intro", "builtin:markdown", { title: "What this shows" }),
        statCard("revenue", 0),
        widget("trend", "builtin:chart", {
          title: "Revenue trend",
          grid: { x: 4, y: 0, w: 8, h: 4 },
          bindings: { value: { source: "static", value: [1, 2, 3, 4] } },
        }),
      ]),
    ]);
    expect(reviewWorkspace(clean)).toEqual([]);
  });

  it("orders findings by tab, then tab-level before widget-level, then registry last", () => {
    const first = tab("data", [
      widget("c1", "builtin:chart", {
        bindings: { value: { source: "static", value: [1] } },
      }),
    ]);
    const second = tab(
      "main2",
      Array.from({ length: 11 }, (_, i) => statCard(`s${i}`, i)),
    );
    const registry: Record<string, DashboardWidgetRegistryEntry> = {
      unused: { status: "pending", createdBy: "agent:planner" },
    };
    const codes = reviewWorkspace(doc([first, second], registry)).map((f) => f.code);
    expect(codes).toEqual([
      "tab-source-named", // tab "data", tab-level
      "chart-untitled", // tab "data", widget c1 (rule order)
      "chart-sparse", // tab "data", widget c1
      "tab-overcrowded", // tab "main2", tab-level (rule order)
      "tab-needs-context", // tab "main2", tab-level
      "registry-orphan", // workspace-level, last
    ]);
  });

  it("makes ephemeral-leftover deterministic via the injectable now", () => {
    const expiry = Date.parse("2020-06-01T00:00:00.000Z");
    const eph = widget("eph", "builtin:stat-card", {
      title: "Answer",
      ephemeral: { expiresAt: "2020-06-01T00:00:00.000Z" },
    });
    const workspace = doc([tab("overview", [eph])]);
    // Before expiry: not yet stale.
    expect(reviewWorkspace(workspace, expiry - 1000)).toEqual([]);
    // After expiry: flagged.
    expect(reviewWorkspace(workspace, expiry + 1000)).toEqual([
      expect.objectContaining({ code: "ephemeral-leftover", widgetId: "eph" }),
    ]);
  });
});
