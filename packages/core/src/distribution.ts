// Workspace export / import (distribution) — pure, DOM-free logic.
//
// The strict `workspace.json` the store persists round-trips through here: export
// serializes it (optionally a tab subset) and import coerces every custom widget
// to `pending` so the approval gate runs before it can mount (SPEC §8.2). DOM
// download/upload glue lives in the view; structural re-validation is left to the
// server (`dashboard.workspace.replace` calls `validateWorkspaceDoc`).

import type { DashboardWidgetStatus } from "./types.js";

const PENDING_STATUS: DashboardWidgetStatus = "pending";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Pull the strict workspace doc out of a `dashboard.workspace.get` payload. The
 * host responds `{ doc, workspaceVersion }`; `.workspace` and the bare payload are
 * accepted as fallbacks so export is robust to the response envelope.
 */
export function workspaceDocFromPayload(payload: unknown): Record<string, unknown> {
  if (isRecord(payload)) {
    if (isRecord(payload.doc)) {
      return payload.doc;
    }
    if (isRecord(payload.workspace)) {
      return payload.workspace;
    }
    return payload;
  }
  return {};
}

/** Timestamped download filename, e.g. `dashboard-workspace-2026-07-08T12-00-00-000Z.json`. */
export function workspaceExportFilename(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `dashboard-workspace-${stamp}.json`;
}

export type WorkspaceExportOptions = { slugs?: readonly string[] };

/** The `custom:<name>` name for a widget kind, or null for builtin/unknown kinds. */
function customName(kind: unknown): string | null {
  if (typeof kind !== "string" || !kind.startsWith("custom:")) {
    return null;
  }
  return kind.slice("custom:".length) || null;
}

/** Every custom-widget name referenced by the tabs' widgets. */
function customWidgetNames(tabs: unknown): Set<string> {
  const names = new Set<string>();
  if (!Array.isArray(tabs)) {
    return names;
  }
  for (const tab of tabs) {
    const widgets = isRecord(tab) && Array.isArray(tab.widgets) ? tab.widgets : [];
    for (const widget of widgets) {
      const name = isRecord(widget) ? customName(widget.kind) : null;
      if (name) {
        names.add(name);
      }
    }
  }
  return names;
}

/** Keep only the registry entries whose custom widget still appears in `tabs`. */
function pruneRegistry(tabs: unknown, registry: unknown): Record<string, unknown> {
  if (!isRecord(registry)) {
    return {};
  }
  const referenced = customWidgetNames(tabs);
  const pruned: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(registry)) {
    if (referenced.has(name)) {
      pruned[name] = entry;
    }
  }
  return pruned;
}

/**
 * Build the export doc: the full workspace, or a subset filtered to `slugs`. A
 * subset prunes `prefs.tabOrder` to the kept slugs and the registry to the custom
 * widgets those tabs still reference, so the result stays a valid WorkspaceDoc.
 */
export function buildWorkspaceExportDoc(
  doc: Record<string, unknown>,
  options: WorkspaceExportOptions = {},
): Record<string, unknown> {
  const clone = structuredClone(doc);
  const slugs = options.slugs;
  if (!slugs || slugs.length === 0) {
    return clone;
  }
  const keep = new Set(slugs);
  const tabs = Array.isArray(clone.tabs)
    ? clone.tabs.filter((tab) => isRecord(tab) && keep.has(tab.slug as string))
    : [];
  clone.tabs = tabs;
  const prefs = isRecord(clone.prefs) ? clone.prefs : {};
  const tabOrder = Array.isArray(prefs.tabOrder) ? prefs.tabOrder : [];
  clone.prefs = {
    ...prefs,
    tabOrder: tabOrder.filter((slug) => typeof slug === "string" && keep.has(slug)),
  };
  clone.widgetsRegistry = pruneRegistry(tabs, clone.widgetsRegistry);
  return clone;
}

/** Serialize the export doc as pretty JSON with a trailing newline (matches the store). */
export function serializeWorkspaceExport(
  doc: Record<string, unknown>,
  options: WorkspaceExportOptions = {},
): string {
  return `${JSON.stringify(buildWorkspaceExportDoc(doc, options), null, 2)}\n`;
}

/** Parse an imported file into JSON, surfacing a friendly error on malformed input. */
export function parseWorkspaceImport(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Import file is not valid JSON.");
  }
}

function toPendingEntry(entry: unknown): Record<string, unknown> {
  const createdBy =
    isRecord(entry) && typeof entry.createdBy === "string" ? entry.createdBy : "user";
  // Drop approvedBy/approvedAt: an imported widget is never carried in approved.
  return { status: PENDING_STATUS, createdBy };
}

/**
 * Coerce every custom widget referenced by an imported doc to `pending` so the
 * approval gate runs before it can mount — an import NEVER auto-approves a custom
 * widget. Forces pending unconditionally because an imported workspace is foreign,
 * untrusted authoring. Structural validation is left to the server
 * (`dashboard.workspace.replace`).
 */
export function sanitizeImportedWorkspace(parsed: unknown): Record<string, unknown> {
  if (!isRecord(parsed)) {
    throw new Error("Import file must be a workspace object.");
  }
  const doc = structuredClone(parsed);
  const registryInput = isRecord(doc.widgetsRegistry) ? doc.widgetsRegistry : {};
  const registry: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(registryInput)) {
    registry[name] = toPendingEntry(entry);
  }
  // A custom widget with no registry entry can never be approved; seed a pending
  // entry so its approval card renders after import.
  for (const name of customWidgetNames(doc.tabs)) {
    registry[name] ??= { status: PENDING_STATUS, createdBy: "user" };
  }
  doc.widgetsRegistry = registry;

  // Capability grants (SPEC §17) re-pend on import for the same reason: an imported
  // board is foreign authoring and must NEVER carry an active data grant. Force every
  // grant back to `requested` and strip who/when-granted; the operator re-approves.
  const capsInput = isRecord(doc.capabilitiesRegistry) ? doc.capabilitiesRegistry : {};
  const caps: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(capsInput)) {
    if (isRecord(entry)) {
      // Strip who/when-granted AND the operator-only auto-run + TTL fields (SPEC §17.2/§17
      // TTLs): an imported board is foreign authoring and carries no active lease.
      const {
        grantedBy: _grantedBy,
        grantedAt: _grantedAt,
        autoConfirm: _autoConfirm,
        expiresAt: _expiresAt,
        ...rest
      } = entry;
      caps[name] = { ...rest, status: "requested" };
    }
  }
  doc.capabilitiesRegistry = caps;
  return doc;
}
