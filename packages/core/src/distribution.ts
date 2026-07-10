// Workspace export / import (distribution) — pure, DOM-free logic.
//
// The strict `workspace.json` the store persists round-trips through here: export
// serializes it (optionally a tab subset) and import coerces every custom widget
// to `pending` so the approval gate runs before it can mount (SPEC §8.2). DOM
// download/upload glue lives in the view; structural re-validation is left to the
// server (`dashboard.workspace.replace` calls `validateWorkspaceDoc`).

import type { RecipeConnectorGrant, TemplateRecipe } from "@boardstate/schema";
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
      // Strip who/when-granted AND every operator-only privilege field — auto-run,
      // TTL lease, and per-agent scope (SPEC §17.2/§17.3): an imported board is
      // foreign authoring; scope claims from a foreign doc are as untrustworthy as
      // a granted status (adversarial verify 2026-07-11 — the import path had been
      // missed when the other re-pend sites gained the agents strip).
      const {
        grantedBy: _grantedBy,
        grantedAt: _grantedAt,
        autoConfirm: _autoConfirm,
        expiresAt: _expiresAt,
        agents: _agents,
        ...rest
      } = entry;
      caps[name] = { ...rest, status: "requested" };
    }
  }
  doc.capabilitiesRegistry = caps;
  return doc;
}

// --- Template recipes (install = import) --------------------------------------
//
// A recipe (`@boardstate/schema` `TemplateRecipe`) is `{ doc, grantsManifest }`.
// Installing it is IMPORTING it: the doc's `capabilitiesRegistry` is built FROM the
// human-labeled `grantsManifest` (the manifest is authoritative — it overwrites any
// grants the doc author left behind), then the whole doc goes through the EXISTING
// `sanitizeImportedWorkspace` re-pend seam. So every manifest grant lands `requested`,
// custom widgets land `pending`, and a recipe can NEVER arrive pre-granted — that
// invariant is enforced by the distribution re-pend here AND, independently, by
// `reconcileReplaceApproval` at the store. No code runs at install; recipes are pure data.

/** The one-liner (grant `description`) for a connector's approval card. */
function recipeGrantDescription(grant: RecipeConnectorGrant): string | undefined {
  const reason = grant.reason?.trim();
  return reason && reason.length > 0 ? reason.slice(0, 200) : undefined;
}

/**
 * Build the workspace doc a recipe installs: the recipe's `doc` with its
 * `capabilitiesRegistry` REPLACED by the grants the `grantsManifest` declares, each
 * `requested`. The result is NOT yet re-pended — pass it through
 * `sanitizeImportedWorkspace` (as `buildRecipeImportDoc` does) so it travels the same
 * seam every imported board does. `toolsHash` is deliberately omitted: the broker
 * reconciles a `requested` grant's tool surface to the connector's live manifest on its
 * next refresh, so the recipe declares INTENT and the host owns the authoritative hash.
 */
export function buildRecipeInstallDoc(recipe: TemplateRecipe): Record<string, unknown> {
  const doc = structuredClone(recipe.doc) as Record<string, unknown>;
  const caps: Record<string, unknown> = {};
  for (const [connector, grant] of Object.entries(recipe.grantsManifest)) {
    const description = recipeGrantDescription(grant);
    const tools = (grant.tools ?? []).map((tool) => tool.id);
    caps[connector] = {
      status: "requested",
      methods: grant.methods ?? [],
      streams: grant.streams ?? [],
      ...(tools.length > 0 ? { tools } : {}),
      ...(description !== undefined ? { description } : {}),
    };
  }
  doc.capabilitiesRegistry = caps;
  return doc;
}

/**
 * The doc to hand `dashboard.workspace.replace` when installing a recipe: the recipe's
 * board with its manifest grants merged in, then run through the SAME
 * `sanitizeImportedWorkspace` re-pend as any imported workspace. Install therefore
 * inherits every import guarantee — pending widgets, requested grants, stripped
 * auto-run/TTL — for free, and can never grant.
 */
export function buildRecipeImportDoc(recipe: TemplateRecipe): Record<string, unknown> {
  return sanitizeImportedWorkspace(buildRecipeInstallDoc(recipe));
}
