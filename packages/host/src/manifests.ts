// Custom-widget manifest loading + cache. `widget.json` for an APPROVED custom
// widget is fetched over the served widget-asset route and shaped into the bridge's
// `WidgetManifestView` (the binding ids + capabilities the operator approved). Only
// approved widgets ever mount an iframe, so only they need a manifest.

import {
  customWidgetName,
  customWidgetStatus,
  type DashboardTab,
  type DashboardWidgetCapability,
  type DashboardWorkspace,
  type WidgetManifestView,
} from "@boardstate/core";

/**
 * Capabilities accepted from a widget manifest. Superset of core's
 * `DashboardWidgetCapability` — `bus:pubsub` (pub/sub) is a real, bridge-gated
 * capability the core enum does not yet enumerate (see host manifest note). Kept as
 * a string allowlist so an unknown capability is dropped, then narrowed to the core
 * type at the boundary.
 */
const ACCEPTED_CAPABILITIES = new Set<string>([
  "data:read",
  "prompt:send",
  "state:persist",
  "bus:pubsub",
]);

/** Builds the served asset URL for a widget file under the widget-asset route. */
export function widgetAssetUrl(basePath: string, name: string, file: string): string {
  const base = basePath.replace(/\/+$/, "");
  const encodedName = encodeURIComponent(name);
  const encodedFile = file
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${base}/widgets/${encodedName}/${encodedFile}`;
}

/** Fetches and shapes a widget's manifest into the bridge's read model. */
export async function loadWidgetManifestView(
  basePath: string,
  name: string,
): Promise<WidgetManifestView | null> {
  if (typeof fetch !== "function") {
    return null;
  }
  try {
    const res = await fetch(widgetAssetUrl(basePath, name, "widget.json"), {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return null;
    }
    const parsed: unknown = await res.json();
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const bindings = Array.isArray(record.bindings) ? record.bindings : [];
    const bindingIds = bindings
      .map((binding) =>
        typeof binding === "object" && binding !== null
          ? (binding as Record<string, unknown>).id
          : undefined,
      )
      .filter((id): id is string => typeof id === "string");
    const capabilities = (Array.isArray(record.capabilities) ? record.capabilities : []).filter(
      (cap): cap is string => typeof cap === "string" && ACCEPTED_CAPABILITIES.has(cap),
    ) as DashboardWidgetCapability[];
    return { name, bindingIds, capabilities };
  } catch {
    return null;
  }
}

/** Per-host manifest cache: loaded manifests survive doc changes; loads are deduped. */
export type ManifestCache = {
  manifestCache: Map<string, WidgetManifestView>;
  manifestLoads: Set<string>;
};

export function createManifestCache(): ManifestCache {
  return { manifestCache: new Map(), manifestLoads: new Set() };
}

/** Manifest for an approved custom widget name, or null when not yet loaded. */
export function getManifest(cache: ManifestCache, name: string): WidgetManifestView | null {
  return cache.manifestCache.get(name) ?? null;
}

/**
 * Load `widget.json` manifests for the APPROVED custom widgets on the active tab.
 * Only approved widgets ever build an iframe, so only they need a manifest; a
 * pending/rejected widget never fetches one. Cached across doc changes by name;
 * `onLoaded` fires after each successful load so the caller can re-render.
 */
export function ensureManifests(
  cache: ManifestCache,
  params: {
    basePath: string;
    workspace: DashboardWorkspace;
    tab: DashboardTab;
    onLoaded?: () => void;
  },
): void {
  const { basePath, workspace, tab, onLoaded } = params;
  for (const widget of tab.widgets) {
    const name = customWidgetName(widget.kind);
    if (
      !name ||
      customWidgetStatus(workspace, widget.kind) !== "approved" ||
      cache.manifestCache.has(name) ||
      cache.manifestLoads.has(name)
    ) {
      continue;
    }
    cache.manifestLoads.add(name);
    void loadWidgetManifestView(basePath, name).then((manifest) => {
      cache.manifestLoads.delete(name);
      if (manifest) {
        cache.manifestCache.set(name, manifest);
        onLoaded?.();
      }
    });
  }
}
