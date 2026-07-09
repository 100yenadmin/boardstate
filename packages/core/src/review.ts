// Pure, deterministic design-lint over a workspace document — the read model behind
// M4a's agent self-review ("the agent critiques and improves its own board"). A
// readOnly review tool wraps `reviewWorkspace` in the host; this module has no
// transport and no DOM. Every rule is its own small, TOTAL function: a weird-but-valid
// doc yields fewer findings, never a throw (missing props/bindings/grid → skip). The
// canonical workspace document shape lives in `@boardstate/schema`.

import type { DashboardTab, DashboardWidget, WorkspaceDoc } from "@boardstate/schema";

export type WorkspaceReviewSeverity = "info" | "warn";

export type WorkspaceReviewFinding = {
  /** Stable kebab-case rule id (one of `WORKSPACE_REVIEW_RULES`). */
  code: string;
  severity: WorkspaceReviewSeverity;
  /** Tab slug the finding is scoped to, when tab-scoped. */
  tab?: string;
  /** Widget id the finding is scoped to, when widget-scoped. */
  widgetId?: string;
  /** Specific, human/agent-readable description of the issue. */
  message: string;
  /** Actionable imperative fix. */
  suggestion: string;
};

/** The rule ids `reviewWorkspace` can emit, in rule order — for docs and tests. */
export const WORKSPACE_REVIEW_RULES = [
  "tab-overcrowded",
  "tab-empty",
  "numbers-not-leading",
  "chart-untitled",
  "tab-source-named",
  "tab-needs-context",
  "ephemeral-leftover",
  "widget-oversized",
  "title-duplicate",
  "chart-sparse",
  "table-unbounded",
  "registry-orphan",
] as const satisfies readonly string[];

const STAT_CARD_KIND = "builtin:stat-card";
const CHART_KIND = "builtin:chart";
const TABLE_KIND = "builtin:table";
const CHART_OR_TABLE_KINDS = new Set([CHART_KIND, TABLE_KIND]);
/** Kinds that render data (rule `tab-needs-context`). */
const DATA_WIDGET_KINDS = new Set([
  "builtin:stat-card",
  "builtin:chart",
  "builtin:table",
  "builtin:usage",
  "builtin:sessions",
  "builtin:activity",
]);
/** Kinds that carry explanatory prose (rule `tab-needs-context`). */
const NARRATIVE_WIDGET_KINDS = new Set(["builtin:markdown", "builtin:notes"]);
/** Slugs named after a data source or placeholder rather than a question. */
const SOURCE_TAB_SLUGS = new Set(["data", "misc", "stuff", "general", "tab", "new", "page"]);

const OVERCROWDED_WIDGET_LIMIT = 10;
const OVERSIZED_HEIGHT = 8;
const OVERSIZED_MIN_NEIGHBORS = 3;
const CONTEXT_MIN_DATA_WIDGETS = 4;
const TABLE_ROW_LIMIT = 10;
const CHART_MIN_POINTS = 3;

const CUSTOM_KIND_PREFIX = "custom:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Widgets of a tab as an array, tolerating a malformed doc. */
function tabWidgets(tab: DashboardTab): DashboardWidget[] {
  return Array.isArray(tab.widgets) ? tab.widgets : [];
}

/** Trimmed widget title, or `""` when absent/blank. */
function widgetTitle(widget: DashboardWidget): string {
  return typeof widget.title === "string" ? widget.title.trim() : "";
}

/** A finite grid coordinate, or undefined when the grid is malformed. */
function gridCoord(widget: DashboardWidget, key: "x" | "y" | "w" | "h"): number | undefined {
  const grid: unknown = widget.grid;
  if (!isRecord(grid)) {
    return undefined;
  }
  const value = grid[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Static point array behind a chart's `value` binding, or null when not a static array. */
function staticPoints(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }
  if (isRecord(value) && Array.isArray(value.points)) {
    return value.points;
  }
  return null;
}

function tabFinding(
  code: string,
  severity: WorkspaceReviewSeverity,
  tab: DashboardTab,
  message: string,
  suggestion: string,
): WorkspaceReviewFinding {
  return { code, severity, tab: tab.slug, message, suggestion };
}

function widgetFinding(
  code: string,
  severity: WorkspaceReviewSeverity,
  tab: DashboardTab,
  widget: DashboardWidget,
  message: string,
  suggestion: string,
): WorkspaceReviewFinding {
  return { code, severity, tab: tab.slug, widgetId: widget.id, message, suggestion };
}

// --- Tab-level rules -------------------------------------------------------

/** 1. `tab-overcrowded`: more than ten widgets crowd a single tab. */
function ruleTabOvercrowded(tab: DashboardTab): WorkspaceReviewFinding[] {
  const count = tabWidgets(tab).length;
  if (count <= OVERCROWDED_WIDGET_LIMIT) {
    return [];
  }
  return [
    tabFinding(
      "tab-overcrowded",
      "warn",
      tab,
      `Tab "${tab.slug}" has ${count} widgets, which is hard to scan.`,
      "Split this tab by question so each tab holds a focused set of widgets.",
    ),
  ];
}

/** 2. `tab-empty`: a visible tab with no widgets. */
function ruleTabEmpty(tab: DashboardTab): WorkspaceReviewFinding[] {
  if (tab.hidden || tabWidgets(tab).length > 0) {
    return [];
  }
  return [
    tabFinding(
      "tab-empty",
      "info",
      tab,
      `Tab "${tab.slug}" is visible but has no widgets.`,
      "Add a widget that answers this tab's question, or hide the tab.",
    ),
  ];
}

/** 3. `numbers-not-leading`: a chart/table leads at y:0 while stat cards sit lower. */
function ruleNumbersNotLeading(tab: DashboardTab): WorkspaceReviewFinding[] {
  const widgets = tabWidgets(tab);
  const statCards = widgets.filter((w) => w.kind === STAT_CARD_KIND);
  const chartsTables = widgets.filter((w) => CHART_OR_TABLE_KINDS.has(w.kind));
  if (statCards.length === 0 || chartsTables.length === 0) {
    return [];
  }
  const statLeads = statCards.some((w) => gridCoord(w, "y") === 0);
  const chartLeads = chartsTables.some((w) => gridCoord(w, "y") === 0);
  if (!chartLeads || statLeads) {
    return [];
  }
  return [
    tabFinding(
      "numbers-not-leading",
      "warn",
      tab,
      `Tab "${tab.slug}" leads with a chart or table while its stat cards sit lower.`,
      "Move a stat card to y:0 so the headline number leads.",
    ),
  ];
}

/** 5. `tab-source-named`: the slug names a data source or placeholder, not a question. */
function ruleTabSourceNamed(tab: DashboardTab): WorkspaceReviewFinding[] {
  if (!SOURCE_TAB_SLUGS.has(tab.slug)) {
    return [];
  }
  return [
    tabFinding(
      "tab-source-named",
      "info",
      tab,
      `Tab "${tab.slug}" is named after its data source, not a question.`,
      "Rename the tab after the question it answers.",
    ),
  ];
}

/** 6. `tab-needs-context`: many data widgets and no explanatory prose. */
function ruleTabNeedsContext(tab: DashboardTab): WorkspaceReviewFinding[] {
  const widgets = tabWidgets(tab);
  const dataCount = widgets.filter((w) => DATA_WIDGET_KINDS.has(w.kind)).length;
  if (dataCount < CONTEXT_MIN_DATA_WIDGETS) {
    return [];
  }
  if (widgets.some((w) => NARRATIVE_WIDGET_KINDS.has(w.kind))) {
    return [];
  }
  return [
    tabFinding(
      "tab-needs-context",
      "info",
      tab,
      `Tab "${tab.slug}" has ${dataCount} data widgets but no explanatory text.`,
      "Add a short markdown or notes widget explaining what the tab shows.",
    ),
  ];
}

/** Widget ids that repeat a non-empty title already seen earlier on the tab. */
function duplicateTitleIds(tab: DashboardTab): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const widget of tabWidgets(tab)) {
    const title = widgetTitle(widget);
    if (!title) {
      continue;
    }
    if (seen.has(title)) {
      duplicates.add(widget.id);
    } else {
      seen.add(title);
    }
  }
  return duplicates;
}

// --- Widget-level rules ----------------------------------------------------

/** 4. `chart-untitled`: a chart widget with no title. */
function ruleChartUntitled(tab: DashboardTab, widget: DashboardWidget): WorkspaceReviewFinding[] {
  if (widget.kind !== CHART_KIND || widgetTitle(widget) !== "") {
    return [];
  }
  return [
    widgetFinding(
      "chart-untitled",
      "info",
      tab,
      widget,
      `Chart "${widget.id}" has no title.`,
      "Give the chart a title naming what it measures.",
    ),
  ];
}

/** 7. `ephemeral-leftover`: a Living Answer that expired before `now`. */
function ruleEphemeralLeftover(
  tab: DashboardTab,
  widget: DashboardWidget,
  now: number,
): WorkspaceReviewFinding[] {
  const expiresAt = widget.ephemeral?.expiresAt;
  if (typeof expiresAt !== "string") {
    return [];
  }
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry) || expiry >= now) {
    return [];
  }
  return [
    widgetFinding(
      "ephemeral-leftover",
      "warn",
      tab,
      widget,
      `Widget "${widget.id}" expired at ${expiresAt} but is still on the board.`,
      "Pin the widget to keep it, or remove the stale Living Answer.",
    ),
  ];
}

/** 8. `widget-oversized`: a tall widget that crowds several neighbors. */
function ruleWidgetOversized(tab: DashboardTab, widget: DashboardWidget): WorkspaceReviewFinding[] {
  const height = gridCoord(widget, "h");
  if (height === undefined || height <= OVERSIZED_HEIGHT) {
    return [];
  }
  const neighbors = tabWidgets(tab).length - 1;
  if (neighbors < OVERSIZED_MIN_NEIGHBORS) {
    return [];
  }
  return [
    widgetFinding(
      "widget-oversized",
      "warn",
      tab,
      widget,
      `Widget "${widget.id}" is ${height} rows tall and crowds the ${neighbors} other widgets on the tab.`,
      "Reduce its height or move it to its own tab.",
    ),
  ];
}

/** 9. `title-duplicate`: a widget repeats a title used earlier on the same tab. */
function ruleTitleDuplicate(
  tab: DashboardTab,
  widget: DashboardWidget,
  duplicates: Set<string>,
): WorkspaceReviewFinding[] {
  if (!duplicates.has(widget.id)) {
    return [];
  }
  return [
    widgetFinding(
      "title-duplicate",
      "info",
      tab,
      widget,
      `Widget "${widget.id}" repeats the title "${widgetTitle(widget)}" already used on this tab.`,
      "Give each widget on the tab a distinct title.",
    ),
  ];
}

/** 10. `chart-sparse`: a chart plotting fewer than three static points. */
function ruleChartSparse(tab: DashboardTab, widget: DashboardWidget): WorkspaceReviewFinding[] {
  if (widget.kind !== CHART_KIND || !isRecord(widget.bindings)) {
    return [];
  }
  const binding = widget.bindings.value;
  if (!isRecord(binding) || binding.source !== "static") {
    return [];
  }
  const points = staticPoints(binding.value);
  if (points === null || points.length >= CHART_MIN_POINTS) {
    return [];
  }
  return [
    widgetFinding(
      "chart-sparse",
      "info",
      tab,
      widget,
      `Chart "${widget.id}" plots fewer than ${CHART_MIN_POINTS} static points.`,
      "Add more data points, or use a stat card for a single value.",
    ),
  ];
}

/** 11. `table-unbounded`: a table with many rows and no row limit. */
function ruleTableUnbounded(tab: DashboardTab, widget: DashboardWidget): WorkspaceReviewFinding[] {
  if (widget.kind !== TABLE_KIND || !isRecord(widget.props)) {
    return [];
  }
  const rows = widget.props.rows;
  if (!Array.isArray(rows) || rows.length <= TABLE_ROW_LIMIT || widget.props.limit !== undefined) {
    return [];
  }
  return [
    widgetFinding(
      "table-unbounded",
      "info",
      tab,
      widget,
      `Table "${widget.id}" has ${rows.length} rows and no row limit.`,
      "Set props.limit so the table shows a bounded number of rows.",
    ),
  ];
}

// --- Workspace-level rules -------------------------------------------------

/** 12. `registry-orphan`: a registered widget name no tab actually uses. */
function ruleRegistryOrphan(doc: WorkspaceDoc): WorkspaceReviewFinding[] {
  const registry = isRecord(doc.widgetsRegistry) ? doc.widgetsRegistry : {};
  const tabs = Array.isArray(doc.tabs) ? doc.tabs : [];
  const used = new Set<string>();
  for (const tab of tabs) {
    for (const widget of tabWidgets(tab)) {
      if (typeof widget.kind === "string" && widget.kind.startsWith(CUSTOM_KIND_PREFIX)) {
        used.add(widget.kind.slice(CUSTOM_KIND_PREFIX.length));
      }
    }
  }
  const findings: WorkspaceReviewFinding[] = [];
  for (const name of Object.keys(registry)) {
    if (used.has(name)) {
      continue;
    }
    findings.push({
      code: "registry-orphan",
      severity: "warn",
      message: `Registered widget "${name}" is not used by any custom:${name} widget.`,
      suggestion: "Place the widget on a tab, or remove it from the registry.",
    });
  }
  return findings;
}

/**
 * Lint a workspace document for design smells, returning findings ordered by tab
 * order then widget order (tab-scoped findings before the tab's widget-scoped ones),
 * with workspace-level findings last. Pure and total — inject `now` to make the
 * `ephemeral-leftover` rule deterministic in tests.
 */
export function reviewWorkspace(
  doc: WorkspaceDoc,
  now: number = Date.now(),
): WorkspaceReviewFinding[] {
  const findings: WorkspaceReviewFinding[] = [];
  const tabs = Array.isArray(doc.tabs) ? doc.tabs : [];
  for (const tab of tabs) {
    findings.push(...ruleTabOvercrowded(tab));
    findings.push(...ruleTabEmpty(tab));
    findings.push(...ruleNumbersNotLeading(tab));
    findings.push(...ruleTabSourceNamed(tab));
    findings.push(...ruleTabNeedsContext(tab));
    const duplicates = duplicateTitleIds(tab);
    for (const widget of tabWidgets(tab)) {
      findings.push(...ruleChartUntitled(tab, widget));
      findings.push(...ruleEphemeralLeftover(tab, widget, now));
      findings.push(...ruleWidgetOversized(tab, widget));
      findings.push(...ruleTitleDuplicate(tab, widget, duplicates));
      findings.push(...ruleChartSparse(tab, widget));
      findings.push(...ruleTableUnbounded(tab, widget));
    }
  }
  findings.push(...ruleRegistryOrphan(doc));
  return findings;
}
