// Client-side workspace time-travel logic: the snapshot-vs-current diff and the
// "first seen version" lookup that powers the blame line. Pure data logic — the
// gateway reads (history.list / history.get) live in the host package; this module
// owns only the diff math (a three-way tab/widget split) over already-loaded docs.

import type { DashboardTab, DashboardWidget, DashboardWorkspace } from "./types.js";

/** A history snapshot doc paired with the version it represents (cached in view state). */
export type DashboardHistorySnapshot = { version: number; workspace: DashboardWorkspace };

export type DashboardDiffKind =
  | "widget-added"
  | "widget-removed"
  | "widget-moved"
  | "widget-retitled"
  | "tab-added"
  | "tab-removed"
  | "tab-retitled";

/**
 * One changelist entry between a historical snapshot and the current doc. `actor`
 * is the `createdBy` provenance used to group the changelist; `label` is the human
 * name (widget/tab title); `detail` carries the before→after context when useful.
 */
export type DashboardDiffEntry = {
  kind: DashboardDiffKind;
  actor: string | null;
  id: string;
  label: string;
  detail?: string;
};

type WidgetLocation = { widget: DashboardWidget; tabSlug: string };

function indexWidgets(workspace: DashboardWorkspace): Map<string, WidgetLocation> {
  const index = new Map<string, WidgetLocation>();
  for (const tab of workspace.tabs) {
    for (const widget of tab.widgets) {
      index.set(widget.id, { widget, tabSlug: tab.slug });
    }
  }
  return index;
}

function indexTabs(workspace: DashboardWorkspace): Map<string, DashboardTab> {
  return new Map(workspace.tabs.map((tab) => [tab.slug, tab]));
}

function sameRect(a: DashboardWidget, b: DashboardWidget): boolean {
  return (
    a.grid.x === b.grid.x && a.grid.y === b.grid.y && a.grid.w === b.grid.w && a.grid.h === b.grid.h
  );
}

/**
 * Compute the changelist to move from `snapshot` (a past state) to `current`. A
 * widget that both moved and was retitled yields two entries. Ordering is stable:
 * tab changes first, then widget added/removed/moved/retitled. The view groups the
 * flat list by `actor`.
 */
export function computeWorkspaceDiff(
  snapshot: DashboardWorkspace,
  current: DashboardWorkspace,
): DashboardDiffEntry[] {
  const entries: DashboardDiffEntry[] = [];
  const snapTabs = indexTabs(snapshot);
  const currTabs = indexTabs(current);

  for (const [slug, tab] of currTabs) {
    if (!snapTabs.has(slug)) {
      entries.push({ kind: "tab-added", actor: tab.createdBy ?? null, id: slug, label: tab.title });
    }
  }
  for (const [slug, tab] of snapTabs) {
    if (!currTabs.has(slug)) {
      entries.push({
        kind: "tab-removed",
        actor: tab.createdBy ?? null,
        id: slug,
        label: tab.title,
      });
    } else {
      const currentTab = currTabs.get(slug)!;
      if (currentTab.title !== tab.title) {
        entries.push({
          kind: "tab-retitled",
          actor: currentTab.createdBy ?? tab.createdBy ?? null,
          id: slug,
          label: currentTab.title,
          detail: `${tab.title} → ${currentTab.title}`,
        });
      }
    }
  }

  const snapWidgets = indexWidgets(snapshot);
  const currWidgets = indexWidgets(current);

  for (const [id, location] of currWidgets) {
    if (!snapWidgets.has(id)) {
      entries.push({
        kind: "widget-added",
        actor: location.widget.createdBy ?? null,
        id,
        label: location.widget.title || id,
      });
    }
  }
  for (const [id, location] of snapWidgets) {
    const currentLocation = currWidgets.get(id);
    if (!currentLocation) {
      entries.push({
        kind: "widget-removed",
        actor: location.widget.createdBy ?? null,
        id,
        label: location.widget.title || id,
      });
      continue;
    }
    const before = location.widget;
    const after = currentLocation.widget;
    if (location.tabSlug !== currentLocation.tabSlug || !sameRect(before, after)) {
      entries.push({
        kind: "widget-moved",
        actor: after.createdBy ?? null,
        id,
        label: after.title || id,
        detail:
          location.tabSlug !== currentLocation.tabSlug
            ? `${location.tabSlug} → ${currentLocation.tabSlug}`
            : undefined,
      });
    }
    if (before.title !== after.title) {
      entries.push({
        kind: "widget-retitled",
        actor: after.createdBy ?? null,
        id,
        label: after.title || id,
        detail: `${before.title || id} → ${after.title || id}`,
      });
    }
  }

  return entries;
}

/** Group a flat changelist by `actor`, preserving first-seen actor order. */
export function groupDiffByActor(
  entries: DashboardDiffEntry[],
): Array<{ actor: string | null; entries: DashboardDiffEntry[] }> {
  const groups = new Map<string | null, DashboardDiffEntry[]>();
  for (const entry of entries) {
    const bucket = groups.get(entry.actor);
    if (bucket) {
      bucket.push(entry);
    } else {
      groups.set(entry.actor, [entry]);
    }
  }
  return [...groups.entries()].map(([actor, grouped]) => ({ actor, entries: grouped }));
}

function hasWidget(workspace: DashboardWorkspace, widgetId: string): boolean {
  return workspace.tabs.some((tab) => tab.widgets.some((widget) => widget.id === widgetId));
}

/**
 * Best-effort "version a widget first appeared", recovered from loaded ring
 * snapshots. Returns the earliest snapshot version that contains the widget ONLY
 * when an even older snapshot lacks it (so the appearance is genuinely observed
 * inside the ring window); otherwise undefined — the widget predates the ring or
 * no bodies are loaded yet, and the blame line falls back to provenance only.
 */
export function firstSeenVersion(
  widgetId: string,
  snapshots: readonly DashboardHistorySnapshot[],
): number | undefined {
  const containing = snapshots
    .filter((snapshot) => hasWidget(snapshot.workspace, widgetId))
    .map((snapshot) => snapshot.version)
    .toSorted((a, b) => a - b);
  if (containing.length === 0) {
    return undefined;
  }
  const earliest = containing[0]!;
  const hasOlderSnapshot = snapshots.some((snapshot) => snapshot.version < earliest);
  return hasOlderSnapshot ? earliest : undefined;
}
