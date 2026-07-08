// Client-side dashboard read models — the view shapes the UI renders from.
//
// These MIRROR the canonical `@boardstate/schema` workspace document but are kept
// distinct on purpose: they model only the fields the client shell reads, and
// every payload is normalized defensively on load (see `queries.ts`) because the
// transport boundary is untyped. Keep them even where they overlap the schema.

export const DASHBOARD_GRID_COLUMNS = 12;

/** Provenance stamp: who authored a tab or widget. `agent:<id>` renders a chip. */
export type DashboardCreatedBy = string;

export type DashboardWidgetKind = string;

export type DashboardBindingSource = "rpc" | "file" | "static";

export type DashboardBinding = {
  source: DashboardBindingSource;
  /** `rpc` bindings name an allowlisted read method resolved client-side. */
  method?: string;
  /** `file` bindings name a path under the host's data dir. */
  path?: string;
  /** JSON pointer into the resolved document. */
  pointer?: string;
  params?: Record<string, unknown>;
  /** `static` bindings carry their value inline. */
  value?: unknown;
};

export type DashboardGridRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Auto-expiry marker (Living Answers): the store sweeps the widget once past `expiresAt`. */
export type DashboardEphemeral = { expiresAt: string };

export type DashboardWidget = {
  id: string;
  kind: DashboardWidgetKind;
  title: string;
  grid: DashboardGridRect;
  collapsed: boolean;
  createdBy?: DashboardCreatedBy;
  bindings?: Record<string, DashboardBinding>;
  props?: Record<string, unknown>;
  /** Present while the widget is a temporary (unpinned) Living Answer. */
  ephemeral?: DashboardEphemeral;
};

/** Tab content layout (SPEC §3): the default 12-col grid, or a single full-bleed widget. */
export type DashboardTabLayout = "grid" | "full";

/** Tab visibility (SPEC §3, §11-I6); server-enforced. Absent === shared. */
export type DashboardTabVisibility = "shared" | "private";

export type DashboardTab = {
  slug: string;
  title: string;
  icon?: string;
  hidden: boolean;
  /** Absent means the default grid layout (full-bleed tab apps use `"full"`). */
  layout?: DashboardTabLayout;
  /** A `private` tab is only served to its owner; the UI marks it with a lock. */
  visibility?: DashboardTabVisibility;
  /** Operator identity that owns a `private` tab (REQUIRED when private per SPEC §3). */
  owner?: string;
  createdBy?: DashboardCreatedBy;
  widgets: DashboardWidget[];
};

export type DashboardPrefs = {
  tabOrder: string[];
};

/** Custom-widget registry status (SPEC §8). Only `approved` widgets get an iframe. */
export type DashboardWidgetStatus = "pending" | "approved" | "rejected";

/** UI read model of one `widgetsRegistry` entry (custom-widget approval state). */
export type DashboardWidgetRegistryEntry = {
  status: DashboardWidgetStatus;
  createdBy?: DashboardCreatedBy;
  approvedBy?: DashboardCreatedBy;
  approvedAt?: string;
};

export type DashboardWorkspace = {
  schemaVersion: number;
  workspaceVersion: number;
  tabs: DashboardTab[];
  prefs: DashboardPrefs;
  /** Custom-widget install/approval state, keyed by widget name (`custom:<name>`). */
  widgetsRegistry: Record<string, DashboardWidgetRegistryEntry>;
};

/** Capability names a custom widget may hold (SPEC §8.1). */
export type DashboardWidgetCapability = "data:read" | "prompt:send" | "state:persist";

/**
 * The subset of a custom widget's `widget.json` manifest the parent bridge needs
 * to gate child requests: which binding ids are declared and which capabilities
 * the operator approved. Loaded on demand by the host from the served manifest.
 */
export type WidgetManifestView = {
  name: string;
  bindingIds: string[];
  capabilities: DashboardWidgetCapability[];
};

/** Payload of the `boardstate.changed` broadcast (SPEC §5). */
export type DashboardChangedEvent = {
  workspaceVersion: number;
  changedTabSlug?: string;
  actor?: string;
};

/** Provenance is an agent authorship when the stamp is prefixed `agent:`. */
export function dashboardAgentProvenance(createdBy: DashboardCreatedBy | undefined): string | null {
  if (typeof createdBy !== "string") {
    return null;
  }
  const trimmed = createdBy.trim();
  return trimmed.startsWith("agent:") ? trimmed.slice("agent:".length) || "agent" : null;
}
