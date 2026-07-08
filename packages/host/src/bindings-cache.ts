// Per-host resolved-binding cache for the client read path. Resolves each widget's
// primary binding once per (workspaceVersion × dataVersion) and caches the result by
// widgetId, so a re-render reuses values and a poll tick (which bumps `dataVersion`)
// or a doc change both invalidate the cache. Framework-free — the caller renders
// from `getBindingResult` and passes an `onResolved` callback to re-render.

import type {
  DashboardBinding,
  DashboardTab,
  DashboardWorkspace,
  Transport,
} from "@boardstate/core";
import { resolveBinding, type DashboardBindingResult } from "./store.js";

export type BindingCache = {
  /** Resolved binding result keyed by widgetId; cleared when the cache key changes. */
  bindingResults: Map<string, DashboardBindingResult>;
  bindingLoads: Set<string>;
  bindingVersion: number;
  /**
   * Monotonic data-refresh counter bumped by the poll timer. Folded into the cache
   * key so a poll tick re-resolves data-widget bindings without a doc-version change.
   */
  dataVersion: number;
};

export function createBindingCache(): BindingCache {
  return { bindingResults: new Map(), bindingLoads: new Set(), bindingVersion: -1, dataVersion: 0 };
}

/** Read the current data-refresh counter (used by the poll timer's tick). */
export function bindingDataVersion(cache: BindingCache): number {
  return cache.dataVersion;
}

/** Advance the data-refresh counter so the next ensureBindings re-resolves. */
export function bumpBindingDataVersion(cache: BindingCache): void {
  cache.dataVersion += 1;
}

/** Cached result for a widget, or undefined until it resolves. */
export function getBindingResult(
  cache: BindingCache,
  widgetId: string,
): DashboardBindingResult | undefined {
  return cache.bindingResults.get(widgetId);
}

/** Primary binding for a widget (first declared), if any. */
export function primaryBinding(widget: {
  bindings?: Record<string, DashboardBinding>;
}): DashboardBinding | null {
  const bindings = widget.bindings;
  if (!bindings) {
    return null;
  }
  const first = Object.values(bindings)[0];
  return first ?? null;
}

/**
 * Cache key mixing the workspace version with the data-refresh counter: a doc change
 * OR a poll tick both invalidate resolved bindings. Overflow-safe: only equality is
 * compared.
 */
export function bindingCacheKey(workspace: DashboardWorkspace, cache: BindingCache): number {
  return workspace.workspaceVersion * 1_000_003 + cache.dataVersion;
}

/**
 * Kick off binding resolution for widgets on the active tab; cache per version.
 * `onResolved` fires after each binding settles so the caller can re-render.
 */
export function ensureBindings(
  cache: BindingCache,
  transport: Transport | null,
  workspace: DashboardWorkspace,
  tab: DashboardTab,
  onResolved?: (() => void) | null,
): void {
  const key = bindingCacheKey(workspace, cache);
  if (cache.bindingVersion !== key) {
    cache.bindingResults.clear();
    cache.bindingLoads.clear();
    cache.bindingVersion = key;
  }
  for (const widget of tab.widgets) {
    const binding = primaryBinding(widget);
    if (!binding || cache.bindingResults.has(widget.id) || cache.bindingLoads.has(widget.id)) {
      continue;
    }
    cache.bindingLoads.add(widget.id);
    void resolveBinding(transport, binding).then((result) => {
      cache.bindingResults.set(widget.id, result);
      cache.bindingLoads.delete(widget.id);
      onResolved?.();
    });
  }
}
