// Pure workspace read-model logic for a dashboard client: defensive normalization
// of an untyped transport payload into `DashboardWorkspace`, tab ordering /
// resolution, custom-widget status lookup, and JSON-pointer application. No
// transport, no DOM — the transport-backed controller (load, subscribe, optimistic
// mutations) lives in the host package and drives these functions.

import {
  DASHBOARD_GRID_COLUMNS,
  dashboardAgentProvenance,
  type DashboardBinding,
  type DashboardCapabilityGrant,
  type DashboardCapabilityStatus,
  type DashboardEphemeral,
  type DashboardGridRect,
  type DashboardTab,
  type DashboardWidget,
  type DashboardWidgetRegistryEntry,
  type DashboardWidgetStatus,
  type DashboardWorkspace,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeRect(value: unknown): DashboardGridRect {
  const record = isRecord(value) ? value : {};
  const w = Math.min(DASHBOARD_GRID_COLUMNS, Math.max(1, Math.trunc(readNumber(record.w, 4))));
  const h = Math.max(1, Math.trunc(readNumber(record.h, 2)));
  const x = Math.min(DASHBOARD_GRID_COLUMNS - w, Math.max(0, Math.trunc(readNumber(record.x, 0))));
  const y = Math.max(0, Math.trunc(readNumber(record.y, 0)));
  return { x, y, w, h };
}

function normalizeBinding(value: unknown): DashboardBinding | null {
  if (!isRecord(value)) {
    return null;
  }
  const source = value.source;
  if (
    source !== "rpc" &&
    source !== "file" &&
    source !== "static" &&
    source !== "stream" &&
    source !== "computed" &&
    source !== "mcp"
  ) {
    return null;
  }
  return {
    source,
    ...(typeof value.method === "string" ? { method: value.method } : {}),
    ...(typeof value.path === "string" ? { path: value.path } : {}),
    ...(typeof value.pointer === "string" ? { pointer: value.pointer } : {}),
    ...(isRecord(value.params) ? { params: value.params } : {}),
    ...("value" in value ? { value: value.value } : {}),
    ...(typeof value.event === "string" ? { event: value.event } : {}),
    ...(typeof value.op === "string" ? { op: value.op } : {}),
    ...(Array.isArray(value.inputs)
      ? { inputs: value.inputs.filter((input): input is string => typeof input === "string") }
      : {}),
    ...(typeof value.arg === "string" ? { arg: value.arg } : {}),
    ...(typeof value.connector === "string" ? { connector: value.connector } : {}),
    ...(typeof value.tool === "string" ? { tool: value.tool } : {}),
    ...(isRecord(value.args) ? { args: value.args } : {}),
  };
}

function normalizeBindings(value: unknown): Record<string, DashboardBinding> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const bindings: Record<string, DashboardBinding> = {};
  for (const [key, raw] of Object.entries(value)) {
    const binding = normalizeBinding(raw);
    if (binding) {
      bindings[key] = binding;
    }
  }
  return Object.keys(bindings).length ? bindings : undefined;
}

function normalizeWidget(value: unknown): DashboardWidget | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id).trim();
  const kind = readString(value.kind).trim();
  if (!id || !kind) {
    return null;
  }
  const ephemeral = normalizeEphemeral(value.ephemeral);
  return {
    id,
    kind,
    title: readString(value.title),
    grid: normalizeRect(value.grid),
    collapsed: value.collapsed === true,
    ...(typeof value.createdBy === "string" ? { createdBy: value.createdBy } : {}),
    ...(normalizeBindings(value.bindings) ? { bindings: normalizeBindings(value.bindings) } : {}),
    ...(isRecord(value.props) ? { props: value.props } : {}),
    ...(ephemeral ? { ephemeral } : {}),
  };
}

/** Read the ephemeral marker if present and well-formed (`{ expiresAt: string }`). */
function normalizeEphemeral(value: unknown): DashboardEphemeral | null {
  if (!isRecord(value) || typeof value.expiresAt !== "string" || !value.expiresAt.trim()) {
    return null;
  }
  return { expiresAt: value.expiresAt };
}

function normalizeTab(value: unknown): DashboardTab | null {
  if (!isRecord(value)) {
    return null;
  }
  const slug = readString(value.slug).trim();
  if (!slug) {
    return null;
  }
  const widgets = Array.isArray(value.widgets)
    ? value.widgets.map(normalizeWidget).filter((w): w is DashboardWidget => w !== null)
    : [];
  return {
    slug,
    title: readString(value.title, slug),
    hidden: value.hidden === true,
    widgets,
    ...(value.layout === "full" || value.layout === "grid" ? { layout: value.layout } : {}),
    ...(value.visibility === "private" ? { visibility: "private" as const } : {}),
    ...(typeof value.owner === "string" ? { owner: value.owner } : {}),
    ...(typeof value.icon === "string" ? { icon: value.icon } : {}),
    ...(typeof value.createdBy === "string" ? { createdBy: value.createdBy } : {}),
  };
}

const WIDGET_STATUSES = new Set<DashboardWidgetStatus>(["pending", "approved", "rejected"]);

function normalizeRegistryEntry(value: unknown): DashboardWidgetRegistryEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const status = value.status;
  if (typeof status !== "string" || !WIDGET_STATUSES.has(status as DashboardWidgetStatus)) {
    return null;
  }
  return {
    status: status as DashboardWidgetStatus,
    ...(typeof value.createdBy === "string" ? { createdBy: value.createdBy } : {}),
    ...(typeof value.approvedBy === "string" ? { approvedBy: value.approvedBy } : {}),
    ...(typeof value.approvedAt === "string" ? { approvedAt: value.approvedAt } : {}),
  };
}

function normalizeWidgetsRegistry(value: unknown): Record<string, DashboardWidgetRegistryEntry> {
  if (!isRecord(value)) {
    return {};
  }
  const registry: Record<string, DashboardWidgetRegistryEntry> = {};
  for (const [name, raw] of Object.entries(value)) {
    const entry = normalizeRegistryEntry(raw);
    if (entry) {
      registry[name] = entry;
    }
  }
  return registry;
}

const CAPABILITY_STATUSES = new Set<DashboardCapabilityStatus>(["requested", "granted", "revoked"]);

/** Read one capability grant defensively; drops a malformed entry (returns null). */
function normalizeCapabilityGrant(value: unknown): DashboardCapabilityGrant | null {
  if (!isRecord(value)) {
    return null;
  }
  const status = value.status;
  if (typeof status !== "string" || !CAPABILITY_STATUSES.has(status as DashboardCapabilityStatus)) {
    return null;
  }
  const strings = (raw: unknown): string[] =>
    Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : [];
  return {
    status: status as DashboardCapabilityStatus,
    methods: strings(value.methods),
    streams: strings(value.streams),
    // `tools`/`toolsHash` (SPEC §17 v2) carried only when present, so a pre-§17
    // grant normalizes byte-identically (no new keys).
    ...(Array.isArray(value.tools) ? { tools: strings(value.tools) } : {}),
    ...(typeof value.toolsHash === "string" ? { toolsHash: value.toolsHash } : {}),
    // `autoConfirm`/`expiresAt` (SPEC §17.2/§17 TTL) carried only when present, so a
    // pre-#62/#64 grant normalizes byte-identically (no new keys invented on output).
    ...(Array.isArray(value.autoConfirm) ? { autoConfirm: strings(value.autoConfirm) } : {}),
    ...(typeof value.expiresAt === "string" ? { expiresAt: value.expiresAt } : {}),
    // `agents` (SPEC §17.3, #59) carried only when present, so an unscoped grant
    // normalizes byte-identically (no new key invented on output).
    ...(Array.isArray(value.agents) ? { agents: strings(value.agents) } : {}),
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    ...(typeof value.grantedBy === "string" ? { grantedBy: value.grantedBy } : {}),
    ...(typeof value.grantedAt === "string" ? { grantedAt: value.grantedAt } : {}),
  };
}

function normalizeCapabilitiesRegistry(value: unknown): Record<string, DashboardCapabilityGrant> {
  if (!isRecord(value)) {
    return {};
  }
  const registry: Record<string, DashboardCapabilityGrant> = {};
  for (const [name, raw] of Object.entries(value)) {
    const grant = normalizeCapabilityGrant(raw);
    if (grant) {
      registry[name] = grant;
    }
  }
  return registry;
}

export function normalizeWorkspace(payload: unknown): DashboardWorkspace {
  const record = isRecord(payload) ? payload : {};
  const tabs = Array.isArray(record.tabs)
    ? record.tabs.map(normalizeTab).filter((tab): tab is DashboardTab => tab !== null)
    : [];
  const prefsRecord = isRecord(record.prefs) ? record.prefs : {};
  const tabOrder = Array.isArray(prefsRecord.tabOrder)
    ? prefsRecord.tabOrder.filter((slug): slug is string => typeof slug === "string")
    : [];
  return {
    schemaVersion: readNumber(record.schemaVersion, 1),
    workspaceVersion: readNumber(record.workspaceVersion, 0),
    tabs,
    prefs: { tabOrder },
    widgetsRegistry: normalizeWidgetsRegistry(record.widgetsRegistry),
    capabilitiesRegistry: normalizeCapabilitiesRegistry(record.capabilitiesRegistry),
  };
}

/** The `custom:<name>` widget name, or null for builtin/unknown kinds. */
export function customWidgetName(kind: string): string | null {
  return kind.startsWith("custom:") ? kind.slice("custom:".length) || null : null;
}

/** Registry status for a custom widget kind, or null when not a tracked custom widget. */
export function customWidgetStatus(
  workspace: DashboardWorkspace,
  kind: string,
): DashboardWidgetStatus | null {
  const name = customWidgetName(kind);
  if (!name) {
    return null;
  }
  return workspace.widgetsRegistry[name]?.status ?? null;
}

/**
 * Tabs in display order: honor `prefs.tabOrder` first, then any doc-order tabs the
 * ordering omits, so a partial `tabOrder` still shows every tab.
 */
export function orderedTabs(workspace: DashboardWorkspace): DashboardTab[] {
  const bySlug = new Map(workspace.tabs.map((tab) => [tab.slug, tab]));
  const ordered: DashboardTab[] = [];
  const seen = new Set<string>();
  for (const slug of workspace.prefs.tabOrder) {
    const tab = bySlug.get(slug);
    if (tab && !seen.has(slug)) {
      ordered.push(tab);
      seen.add(slug);
    }
  }
  for (const tab of workspace.tabs) {
    if (!seen.has(tab.slug)) {
      ordered.push(tab);
      seen.add(tab.slug);
    }
  }
  return ordered;
}

export function visibleTabs(workspace: DashboardWorkspace): DashboardTab[] {
  return orderedTabs(workspace).filter((tab) => !tab.hidden);
}

export function hiddenTabs(workspace: DashboardWorkspace): DashboardTab[] {
  return orderedTabs(workspace).filter((tab) => tab.hidden);
}

/** Which actor bucket a tab belongs to in the per-agent nesting strip. */
export type DashboardTabGroupKind = "user" | "system" | "agent";

export type DashboardTabGroup = {
  /** Stable group key: `"user"`, `"system"`, or `"agent:<id>"`. */
  key: string;
  kind: DashboardTabGroupKind;
  /** Agent id for an `agent` group, else null. */
  agentId: string | null;
  tabs: DashboardTab[];
};

/**
 * Bucket tabs by their `createdBy` provenance for the per-agent nesting strip: a
 * `user` group (also the default for an unstamped tab), a `system` group, and one
 * group per distinct `agent:<id>`. Group order follows each actor's first
 * appearance in the input and tab order within a group is preserved, so callers
 * pass already-ordered (visible) tabs.
 */
export function groupTabsByActor(tabs: DashboardTab[]): DashboardTabGroup[] {
  const groups: DashboardTabGroup[] = [];
  const byKey = new Map<string, DashboardTabGroup>();
  for (const tab of tabs) {
    const agentId = dashboardAgentProvenance(tab.createdBy);
    const kind: DashboardTabGroupKind = agentId
      ? "agent"
      : tab.createdBy === "system"
        ? "system"
        : "user";
    const key = kind === "agent" ? `agent:${agentId}` : kind;
    let group = byKey.get(key);
    if (!group) {
      group = { key, kind, agentId: kind === "agent" ? agentId : null, tabs: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.tabs.push(tab);
  }
  return groups;
}

export function findTab(
  workspace: DashboardWorkspace,
  slug: string | null,
): DashboardTab | undefined {
  if (!slug) {
    return undefined;
  }
  return workspace.tabs.find((tab) => tab.slug === slug);
}

/**
 * Resolve which tab is active: prefer the requested slug if it exists and is not
 * hidden; otherwise fall back to the first visible tab (or first tab of any kind).
 */
export function resolveActiveSlug(
  workspace: DashboardWorkspace,
  requested: string | null,
): string | null {
  const requestedTab = findTab(workspace, requested);
  if (requestedTab) {
    return requestedTab.slug;
  }
  const visible = visibleTabs(workspace);
  if (visible.length > 0) {
    return visible[0]!.slug;
  }
  return orderedTabs(workspace)[0]?.slug ?? null;
}

/** Apply a JSON pointer (RFC 6901 subset) to a value; returns the value if empty. */
export function applyPointer(value: unknown, pointer: string | undefined): unknown {
  if (!pointer) {
    return value;
  }
  const segments = pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current: unknown = value;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
    } else if (isRecord(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}
