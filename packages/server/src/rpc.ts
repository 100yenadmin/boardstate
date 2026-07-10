// The Boardstate control-plane protocol (SPEC §4–5, §10), registered onto a host.
//
// Every mutating method validates its params against a per-method allowed-keys
// whitelist (unknown keys are rejected at the wire — SPEC §4/§12), commits through
// the single validated store, then broadcasts exactly one `boardstate.changed`
// event (SPEC §5). Every doc-serializing response is filtered through the
// private-tab visibility rule for the requesting operator (SPEC §11-I6). This file
// is the union of the base 14 methods plus the shipped extensions: widget write-back
// (§10), time-travel history, gallery install, presence, and full-bleed/ephemeral
// tab+widget support.

// Web Crypto `randomUUID` (Node 20+ and browsers) — keeps rpc.ts browser-safe so
// the control plane can register onto an in-browser in-process host.
const randomUUID = (): string => globalThis.crypto.randomUUID();
import {
  isDashboardActor,
  validateWorkspaceDoc,
  type DashboardActor,
  type DashboardBinding,
  type DashboardEphemeral,
  type DashboardGrid,
  type DashboardTab,
  type DashboardWidget,
  type JsonValue,
  type WorkspaceDoc,
} from "@boardstate/schema";
import {
  filterWorkspaceForOperator,
  resolveBinding,
  type DashboardStore,
  type ResolveBindingOptions,
} from "@boardstate/core";
import { formatError, type RpcHandlerContext, type ServerHost } from "./host.js";
import { registerChatRpc, type ChatAgent, type ChatSessions } from "./chat.js";
import type { InstallWidgetOptions, WidgetBundleInput } from "./install.js";

/**
 * Installs a validated widget bundle (SPEC §8.2 — lands `pending`). This is the
 * node implementation (`@boardstate/server/node` `installWidgetBundle`); it is
 * INJECTED so rpc.ts stays browser-safe (the bundle writer touches `node:fs`). A
 * browser host omits it and the `dashboard.widget.install` method errors.
 */
export type WidgetBundleInstaller = (
  store: DashboardStore,
  bundle: WidgetBundleInput,
  ctx: InstallWidgetOptions,
) => Promise<{ doc: WorkspaceDoc }>;

/** Resolves a data binding server-side. Node hosts inject `@boardstate/core/node`'s. */
export type BindingResolver = (
  binding: unknown,
  options?: ResolveBindingOptions,
) => Promise<unknown>;

const TAB_SLUG_PATTERN = /^[a-z0-9-]{1,40}$/;
const WIDGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,48}$/;
const CUSTOM_WIDGET_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const CONNECTOR_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

type Ctx = RpcHandlerContext;
type Respond = Ctx["respond"];

export type RegisterBoardstateRpcOptions = {
  store: DashboardStore;
  dataRead?: ResolveBindingOptions;
  /** Full (file-capable) binding resolver; defaults to the browser-safe core resolver (file bindings then error). */
  resolveBinding?: BindingResolver;
  /** Node widget-bundle installer; when absent, `dashboard.widget.install` errors. */
  installWidgetBundle?: WidgetBundleInstaller;
  /**
   * Chat session plumbing (SPEC §14). When provided, `chat.history.get` and
   * `chat.abort` are registered; when absent, no chat method exists.
   */
  chat?: ChatSessions;
  /**
   * Agent loop backing `chat.send` (SPEC §14.1). Requires `chat`. When set, `chat.send`
   * is registered; when absent, a host with no agent loop rejects `chat.send`.
   */
  chatAgent?: ChatAgent;
  /**
   * Anti-rug-pull hash resolver for the partial-grant path (SPEC §17.1): given a
   * connector and the SUBSET of `connector:tool` ids being granted, return the digest
   * over exactly those tools' live schemas. A broker-aware node host injects
   * `installBrokerActions(...).capabilityToolsHash`; absent (browser host, no broker)
   * ⇒ a partial approve carries the existing `toolsHash` forward.
   */
  capabilityToolsHash?: (connector: string, toolIds: string[]) => string | undefined;
  /**
   * Clock (ms) for the grant-TTL future-dating check (SPEC §17 TTLs, #64). Injectable so a
   * test's faked clock governs both the store sweep AND the approve verb's "must be
   * future-dated" guard. Defaults to `Date.now`.
   */
  now?: () => number;
};

function respondError(respond: Respond, error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "boardstate_error";
  respond(false, undefined, { code, message: formatError(error) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readParams(params: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (!isRecord(params)) {
    throw new Error("params must be an object");
  }
  for (const key of Object.keys(params)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`unexpected param: ${key}`);
    }
  }
  return params;
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
  description: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${description} is required`);
  }
  return value.trim();
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }
  return value.trim();
}

/**
 * Read the optional partial-grant `tools` subset (SPEC §17.1): an array of
 * `connector:tool` ids the operator ticked. Absent ⇒ approve-all (undefined). Shape
 * is checked here; the intersection with the requested set (which is already
 * schema-validated) discards anything not actually requested.
 */
function readToolsSubset(record: Record<string, unknown>): string[] | undefined {
  const value = record.tools;
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("tools must be an array of connector:tool ids");
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > 129) {
      throw new Error(`tools[${index}] must be a connector:tool id`);
    }
    return entry;
  });
}

/**
 * Read the optional per-tool auto-confirm subset (SPEC §17.2, #62): an array of
 * `connector:tool` ids the operator marked "always allow". Absent ⇒ the approve sets no
 * auto-confirm (and clears any prior one — the approve verb is the sole source of truth).
 * Shape is checked here; the caller intersects it against the granted tools and the
 * schema validator rejects any id outside the grant.
 */
function readAutoConfirmSubset(record: Record<string, unknown>): string[] | undefined {
  const value = record.autoConfirm;
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("autoConfirm must be an array of connector:tool ids");
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > 129) {
      throw new Error(`autoConfirm[${index}] must be a connector:tool id`);
    }
    return entry;
  });
}

/**
 * Read the optional per-agent scope (SPEC §17.3, #59): an array of agent actors
 * (`agent:<id>`) the operator scoped this grant to. Absent ⇒ the approve sets no scope
 * (and CLEARS any prior one — the approve verb is the sole writer). Shape is checked here;
 * the schema validator additionally rejects non-agent actors, an empty list, and
 * duplicates. Operator narrowing/widening is legitimate (this verb carries operator
 * intent); only the agent/reconcile path re-pends on a scope change.
 */
function readAgentsScope(record: Record<string, unknown>): string[] | undefined {
  const value = record.agents;
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("agents must be an array of agent actors");
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > 71) {
      throw new Error(`agents[${index}] must be an agent actor`);
    }
    return entry;
  });
}

/**
 * Read the optional grant TTL (SPEC §17 TTLs, #64): an ISO-8601 instant that MUST be
 * future-dated at write (`nowMs` is the injected clock). Absent ⇒ a permanent grant.
 */
function readFutureExpiresAt(record: Record<string, unknown>, nowMs: number): string | undefined {
  const value = record.expiresAt;
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("expiresAt must be an ISO 8601 timestamp");
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error("expiresAt must be an ISO 8601 timestamp");
  }
  if (parsed <= nowMs) {
    throw new Error("expiresAt must be in the future");
  }
  return value;
}

function readOptionalActor(record: Record<string, unknown>): DashboardActor {
  const actor = record.actor ?? "user";
  if (!isDashboardActor(actor)) {
    throw new Error("actor is invalid");
  }
  return actor;
}

function readVersion(record: Record<string, unknown>, key = "version"): number {
  const value = record[key];
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${key} must be a non-negative integer`);
  }
  return value as number;
}

function readOptionalVisibility(record: Record<string, unknown>): "shared" | "private" | undefined {
  const value = record.visibility;
  if (value === undefined) {
    return undefined;
  }
  if (value !== "shared" && value !== "private") {
    throw new Error('visibility must be "shared" or "private"');
  }
  return value;
}

function readSlug(record: Record<string, unknown>, key = "slug"): string {
  const slug = readRequiredString(record, key, key);
  if (!TAB_SLUG_PATTERN.test(slug)) {
    throw new Error(`${key} is invalid`);
  }
  return slug;
}

function readWidgetId(record: Record<string, unknown>, key = "id"): string {
  const id = readRequiredString(record, key, key);
  if (!WIDGET_ID_PATTERN.test(id)) {
    throw new Error(`${key} is invalid`);
  }
  return id;
}

function readBooleanPatch(record: Record<string, unknown>, key: string): boolean | undefined {
  if (!Object.hasOwn(record, key)) {
    return undefined;
  }
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean`);
  }
  return value;
}

function readGrid(value: unknown, path = "grid"): DashboardGrid {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!["x", "y", "w", "h"].includes(key)) {
      throw new Error(`${path}.${key} is not allowed`);
    }
  }
  return {
    x: readGridInt(value.x, `${path}.x`, 0, 11),
    y: readGridInt(value.y, `${path}.y`, 0, 499),
    w: readGridInt(value.w, `${path}.w`, 1, 12),
    h: readGridInt(value.h, `${path}.h`, 1, 20),
  };
}

function readGridInt(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${path} must be an integer from ${min} to ${max}`);
  }
  return value as number;
}

function slugBase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

function makeUniqueSlug(title: string, tabs: DashboardTab[]): string {
  const used = new Set(tabs.map((tab) => tab.slug));
  const base = slugBase(title) || "tab";
  if (!used.has(base)) {
    return base;
  }
  for (let index = 2; index < 1000; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${base.slice(0, 40 - suffix.length)}${suffix}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  throw new Error("could not generate a unique tab slug");
}

function makeWidgetIdBase(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/g, "") || `w_${randomUUID().replaceAll("-", "").slice(0, 12)}`
  );
}

function makeUniqueWidgetId(widget: Record<string, unknown>, doc: WorkspaceDoc): string {
  const existing = new Set(doc.tabs.flatMap((tab) => tab.widgets.map((entry) => entry.id)));
  const explicit = widget.id;
  if (explicit !== undefined) {
    if (typeof explicit !== "string" || !WIDGET_ID_PATTERN.test(explicit)) {
      throw new Error("widget.id is invalid");
    }
    if (existing.has(explicit)) {
      throw new Error(`duplicate widget id: ${explicit}`);
    }
    return explicit;
  }
  const title =
    typeof widget.title === "string"
      ? widget.title
      : typeof widget.kind === "string"
        ? widget.kind
        : "widget";
  const base = makeWidgetIdBase(title);
  if (!existing.has(base)) {
    return base;
  }
  for (let index = 2; index < 1000; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${base.slice(0, 48 - suffix.length)}${suffix}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  throw new Error("could not generate a unique widget id");
}

function findTab(doc: WorkspaceDoc, slug: string): DashboardTab {
  const tab = doc.tabs.find((entry) => entry.slug === slug);
  if (!tab) {
    throw new Error(`dashboard tab not found: ${slug}`);
  }
  return tab;
}

function findWidget(tab: DashboardTab, id: string): DashboardWidget {
  const widget = tab.widgets.find((entry) => entry.id === id);
  if (!widget) {
    throw new Error(`dashboard widget not found: ${id}`);
  }
  return widget;
}

function readEphemeralInput(value: unknown): DashboardEphemeral {
  if (!isRecord(value)) {
    throw new Error("widget.ephemeral must be an object");
  }
  return { expiresAt: readRequiredString(value, "expiresAt", "widget.ephemeral.expiresAt") };
}

/**
 * Coerce a JSON-encoded-string props object back to the object (models routinely
 * double-encode); reject other non-object props loudly instead of letting them
 * silently strip every renderer's format/type/labels.
 */
function readPropsInput(value: unknown): JsonValue {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isRecord(parsed)) {
        return parsed as JsonValue;
      }
    } catch {
      // Fall through to the loud error below.
    }
    throw new Error('props must be a JSON object (e.g. { "format": "usd" }), not a string');
  }
  if (value !== undefined && !isRecord(value)) {
    throw new Error("props must be a JSON object");
  }
  return value as JsonValue;
}

function readWidgetInput(value: unknown, doc: WorkspaceDoc): DashboardWidget {
  if (!isRecord(value)) {
    throw new Error("widget must be an object");
  }
  for (const key of Object.keys(value)) {
    if (
      ![
        "id",
        "kind",
        "title",
        "grid",
        "collapsed",
        "hidden",
        "bindings",
        "props",
        "ephemeral",
      ].includes(key)
    ) {
      throw new Error(`widget.${key} is not allowed`);
    }
  }
  const title = readOptionalString(value, "title");
  return {
    id: makeUniqueWidgetId(value, doc),
    kind: readRequiredString(value, "kind", "widget.kind"),
    ...(title !== undefined ? { title } : {}),
    grid: readGrid(value.grid, "widget.grid"),
    collapsed: value.collapsed === undefined ? false : readRequiredBoolean(value, "collapsed"),
    hidden: value.hidden === undefined ? false : readRequiredBoolean(value, "hidden"),
    ...(value.bindings !== undefined
      ? { bindings: value.bindings as Record<string, DashboardBinding> }
      : {}),
    ...(value.props !== undefined ? { props: readPropsInput(value.props) } : {}),
    ...(value.ephemeral !== undefined ? { ephemeral: readEphemeralInput(value.ephemeral) } : {}),
  };
}

function readRequiredBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean`);
  }
  return value;
}

function readTabLayoutPatch(record: Record<string, unknown>): DashboardTab["layout"] | undefined {
  if (!Object.hasOwn(record, "layout")) {
    return undefined;
  }
  const value = record.layout;
  if (value !== "grid" && value !== "full") {
    throw new Error('layout must be "grid" or "full"');
  }
  return value;
}

function readTabPatch(
  value: unknown,
): Partial<Pick<DashboardTab, "title" | "icon" | "hidden" | "layout" | "visibility">> {
  const patch = readParams(value, ["title", "icon", "hidden", "layout", "visibility"]);
  const title = readOptionalString(patch, "title");
  if (title !== undefined && (title.length < 1 || title.length > 80)) {
    throw new Error("patch.title must be 1-80 characters");
  }
  const icon = readOptionalString(patch, "icon");
  if (icon !== undefined && icon.length > 40) {
    throw new Error("patch.icon must be 40 characters or fewer");
  }
  const hidden = readBooleanPatch(patch, "hidden");
  const layout = readTabLayoutPatch(patch);
  const visibility = readOptionalVisibility(patch);
  return {
    ...(title !== undefined ? { title } : {}),
    ...(icon !== undefined ? { icon } : {}),
    ...(hidden !== undefined ? { hidden } : {}),
    ...(layout !== undefined ? { layout } : {}),
    ...(visibility !== undefined ? { visibility } : {}),
  };
}

function readWidgetPatch(value: unknown): Partial<DashboardWidget> {
  const patch = readParams(value, [
    "title",
    "grid",
    "collapsed",
    "hidden",
    "bindings",
    "props",
    "ephemeral",
  ]);
  const title = readOptionalString(patch, "title");
  if (title !== undefined && title.length > 80) {
    throw new Error("patch.title must be 80 characters or fewer");
  }
  return {
    ...(title !== undefined ? { title } : {}),
    ...(patch.grid !== undefined ? { grid: readGrid(patch.grid, "patch.grid") } : {}),
    ...(readBooleanPatch(patch, "collapsed") !== undefined
      ? { collapsed: readBooleanPatch(patch, "collapsed")! }
      : {}),
    ...(readBooleanPatch(patch, "hidden") !== undefined
      ? { hidden: readBooleanPatch(patch, "hidden")! }
      : {}),
    ...(patch.bindings !== undefined
      ? { bindings: patch.bindings as Record<string, DashboardBinding> }
      : {}),
    ...(patch.props !== undefined ? { props: readPropsInput(patch.props) } : {}),
    // `ephemeral: null` pins the widget (clears the flag); an object sets it. The
    // resulting `undefined` is stripped by validateWorkspaceDoc on write.
    ...(Object.hasOwn(patch, "ephemeral")
      ? { ephemeral: patch.ephemeral === null ? undefined : readEphemeralInput(patch.ephemeral) }
      : {}),
  };
}

function readLayout(value: unknown): Array<{ id: string; grid: DashboardGrid }> {
  if (!Array.isArray(value)) {
    throw new Error("layout must be an array");
  }
  return value.map((entry, index) => {
    const record = readParams(entry, ["id", "grid"]);
    return {
      id: readWidgetId(record),
      grid: readGrid(record.grid, `layout[${index}].grid`),
    };
  });
}

function appendMissingTabsToOrder(doc: WorkspaceDoc): void {
  const seen = new Set(doc.prefs.tabOrder);
  for (const tab of doc.tabs) {
    if (!seen.has(tab.slug)) {
      doc.prefs.tabOrder.push(tab.slug);
    }
  }
}

function broadcastChange(
  broadcast: Ctx["broadcast"],
  params: { doc: WorkspaceDoc; actor: DashboardActor; changedTabSlug?: string },
) {
  broadcast("boardstate.changed", {
    workspaceVersion: params.doc.workspaceVersion,
    ...(params.changedTabSlug ? { changedTabSlug: params.changedTabSlug } : {}),
    actor: params.actor,
  });
}

/**
 * Respond to a method with the resulting doc, FILTERED for the requesting operator
 * (SPEC §11-I6) so a response never leaks another operator's private tab back to the
 * caller. `workspaceVersion` stays the real (unfiltered) version so change-event
 * dedup on every client is correct.
 */
function respondDoc(opts: Ctx, doc: WorkspaceDoc): void {
  opts.respond(true, {
    doc: filterWorkspaceForOperator(doc, opts.operatorId),
    workspaceVersion: doc.workspaceVersion,
  });
}

async function respondWrite(
  opts: Ctx,
  actor: DashboardActor,
  changedTabSlug: string | undefined,
  run: () => Promise<{ doc: WorkspaceDoc }>,
) {
  const result = await run();
  broadcastChange(opts.broadcast, { doc: result.doc, actor, changedTabSlug });
  respondDoc(opts, result.doc);
}

function readSlugOrder(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("order must be an array");
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (typeof entry !== "string" || !TAB_SLUG_PATTERN.test(entry)) {
      throw new Error(`order[${index}] is invalid`);
    }
    if (seen.has(entry)) {
      throw new Error(`order contains duplicate slug: ${entry}`);
    }
    seen.add(entry);
    return entry;
  });
}

export function registerBoardstateRpc(host: ServerHost, options: RegisterBoardstateRpcOptions) {
  const store = options.store;

  host.registerRpc(
    "dashboard.workspace.get",
    async (opts) => {
      try {
        // SECURITY (SPEC §11-I6): private tabs are stripped here, in the read path,
        // BEFORE the doc is serialized — a UI-only hide would leak them.
        const doc = await store.read();
        respondDoc(opts, doc);
      } catch (error) {
        respondError(opts.respond, error);
      }
    },
    { scope: "read" },
  );

  host.registerRpc(
    "dashboard.tab.create",
    async (opts) => {
      try {
        const params = readParams(opts.params, ["slug", "title", "icon", "actor", "visibility"]);
        const title = readRequiredString(params, "title", "title");
        const actor = readOptionalActor(params);
        const icon = readOptionalString(params, "icon");
        const visibility = readOptionalVisibility(params);
        // A private tab is owned by the operator creating it (SPEC §11-I6); with no
        // resolvable operator identity the tab is created ownerless and thus
        // (fail-closed) invisible to everyone until an owner can be threaded.
        const operatorId = opts.operatorId;
        const result = await store.mutate(
          (draft) => {
            const slug =
              params.slug === undefined ? makeUniqueSlug(title, draft.tabs) : readSlug(params);
            if (draft.tabs.some((tab) => tab.slug === slug)) {
              throw new Error(`dashboard tab already exists: ${slug}`);
            }
            draft.tabs.push({
              slug,
              title,
              ...(icon !== undefined ? { icon } : {}),
              hidden: false,
              createdBy: actor,
              ...(visibility === "private" ? { visibility } : {}),
              ...(visibility === "private" && operatorId ? { owner: operatorId } : {}),
              widgets: [],
            });
            draft.prefs.tabOrder.push(slug);
          },
          { actor },
        );
        const changedTabSlug = result.doc.tabs.at(-1)?.slug;
        broadcastChange(opts.broadcast, { doc: result.doc, actor, changedTabSlug });
        respondDoc(opts, result.doc);
      } catch (error) {
        respondError(opts.respond, error);
      }
    },
    { scope: "write" },
  );

  host.registerRpc(
    "dashboard.tab.update",
    async (opts) => {
      try {
        const params = readParams(opts.params, ["slug", "patch", "actor"]);
        const slug = readSlug(params);
        const actor = readOptionalActor(params);
        const patch = readTabPatch(params.patch);
        // Re-owning on a visibility transition (SPEC §11-I6): making a tab private
        // stamps the requesting operator as its owner; making it shared clears both
        // markers so `filterWorkspaceForOperator` treats it as public again.
        const operatorId = opts.operatorId;
        await respondWrite(
          opts,
          actor,
          slug,
          async () =>
            await store.mutate(
              (draft) => {
                const tab = findTab(draft, slug);
                Object.assign(tab, patch);
                if (patch.visibility === "private") {
                  if (operatorId) {
                    tab.owner = operatorId;
                  } else {
                    delete tab.owner;
                  }
                } else if (patch.visibility === "shared") {
                  delete tab.visibility;
                  delete tab.owner;
                }
              },
              { actor },
            ),
        );
      } catch (error) {
        respondError(opts.respond, error);
      }
    },
    { scope: "write" },
  );

  host.registerRpc(
    "dashboard.tab.delete",
    async (opts) => {
      try {
        const params = readParams(opts.params, ["slug", "actor"]);
        const slug = readSlug(params);
        const actor = readOptionalActor(params);
        await respondWrite(
          opts,
          actor,
          slug,
          async () =>
            await store.mutate(
              (draft) => {
                const nextTabs = draft.tabs.filter((tab) => tab.slug !== slug);
                if (nextTabs.length === draft.tabs.length) {
                  throw new Error(`dashboard tab not found: ${slug}`);
                }
                draft.tabs = nextTabs;
                draft.prefs.tabOrder = draft.prefs.tabOrder.filter((entry) => entry !== slug);
              },
              { actor },
            ),
        );
      } catch (error) {
        respondError(opts.respond, error);
      }
    },
    { scope: "write" },
  );

  host.registerRpc(
    "dashboard.tab.reorder",
    async (opts) => {
      try {
        const params = readParams(opts.params, ["order", "actor"]);
        const order = readSlugOrder(params.order);
        const actor = readOptionalActor(params);
        await respondWrite(
          opts,
          actor,
          undefined,
          async () =>
            await store.mutate(
              (draft) => {
                const slugs = new Set(draft.tabs.map((tab) => tab.slug));
                for (const slug of order) {
                  if (!slugs.has(slug)) {
                    throw new Error(`dashboard tab not found: ${slug}`);
                  }
                }
                draft.prefs.tabOrder = order;
                appendMissingTabsToOrder(draft);
              },
              { actor },
            ),
        );
      } catch (error) {
        respondError(opts.respond, error);
      }
    },
    { scope: "write" },
  );

  host.registerRpc(
    "dashboard.widget.add",
    async (opts) => {
      try {
        const params = readParams(opts.params, ["tab", "widget", "actor"]);
        const slug = readRequiredString(params, "tab", "tab");
        const actor = readOptionalActor(params);
        await respondWrite(
          opts,
          actor,
          slug,
          async () =>
            await store.mutate(
              (draft) => {
                findTab(draft, slug).widgets.push(readWidgetInput(params.widget, draft));
              },
              { actor },
            ),
        );
      } catch (error) {
        respondError(opts.respond, error);
      }
    },
    { scope: "write" },
  );

  host.registerRpc(
    "dashboard.widget.update",
    async (opts) => {
      try {
        const params = readParams(opts.params, ["tab", "id", "patch", "actor"]);
        const slug = readRequiredString(params, "tab", "tab");
        const id = readWidgetId(params);
        const actor = readOptionalActor(params);
        const patch = readWidgetPatch(params.patch);
        await respondWrite(
          opts,
          actor,
          slug,
          async () =>
            await store.mutate(
              (draft) => {
                Object.assign(findWidget(findTab(draft, slug), id), patch);
              },
              { actor },
            ),
        );
      } catch (error) {
        respondError(opts.respond, error);
      }
    },
    { scope: "write" },
  );

  host.registerRpc(
    "dashboard.widget.move",
    async (opts) => {
      try {
        const params = readParams(opts.params, ["tab", "id", "grid", "toTab", "actor"]);
        if (params.grid !== undefined && params.toTab !== undefined) {
          throw new Error("dashboard.widget.move accepts either grid or toTab, not both");
        }
        const id = readWidgetId(params);
        const actor = readOptionalActor(params);
        const changedTabSlug =
          typeof params.toTab === "string"
            ? params.toTab
            : typeof params.tab === "string"
              ? params.tab
              : undefined;
        await respondWrite(
          opts,
          actor,
          changedTabSlug,
          async () =>
            await store.mutate(
              (draft) => {
                if (params.grid !== undefined) {
                  const slug = readRequiredString(params, "tab", "tab");
                  findWidget(findTab(draft, slug), id).grid = readGrid(params.grid);
                  return;
                }
                const toTab = readRequiredString(params, "toTab", "toTab");
                const destination = findTab(draft, toTab);
                for (const tab of draft.tabs) {
                  const index = tab.widgets.findIndex((widget) => widget.id === id);
                  if (index >= 0) {
                    destination.widgets.push(tab.widgets.splice(index, 1)[0]!);
                    return;
                  }
                }
                throw new Error(`dashboard widget not found: ${id}`);
              },
              { actor },
            ),
        );
      } catch (error) {
        respondError(opts.respond, error);
      }
    },
    { scope: "write" },
  );

  host.registerRpc(
    "dashboard.widget.remove",
    async (opts) => {
      try {
        const params = readParams(opts.params, ["tab", "id", "actor"]);
        const slug = readRequiredString(params, "tab", "tab");
        const id = readWidgetId(params);
        const actor = readOptionalActor(params);
        await respondWrite(
          opts,
          actor,
          slug,
          async () =>
            await store.mutate(
              (draft) => {
                const tab = findTab(draft, slug);
                const next = tab.widgets.filter((widget) => widget.id !== id);
                if (next.length === tab.widgets.length) {
                  throw new Error(`dashboard widget not found: ${id}`);
                }
                tab.widgets = next;
              },
              { actor },
            ),
        );
      } catch (error) {
        respondError(opts.respond, error);
      }
    },
    { scope: "write" },
  );

  host.registerRpc(
    "dashboard.widget.setLayout",
    async (opts) => {
      try {
        const params = readParams(opts.params, ["tab", "layout", "actor"]);
        const slug = readRequiredString(params, "tab", "tab");
        const layout = readLayout(params.layout);
        const actor = readOptionalActor(params);
        await respondWrite(
          opts,
          actor,
          slug,
          async () =>
            await store.mutate(
              (draft) => {
                const tab = findTab(draft, slug);
                for (const entry of layout) {
                  findWidget(tab, entry.id).grid = entry.grid;
                }
              },
              { actor },
            ),
        );
      } catch (error) {
        respondError(opts.respond, error);
      }
    },
    { scope: "write" },
  );

  host.registerRpc(
    "dashboard.widget.approve",
    async (opts) => {
      try {
        const params = readParams(opts.params, ["name", "decision", "actor"]);
        const name = readRequiredString(params, "name", "name");
        if (!CUSTOM_WIDGET_NAME_PATTERN.test(name)) {
          throw new Error("name is invalid");
        }
        const decision = readRequiredString(params, "decision", "decision");
        if (decision !== "approved" && decision !== "rejected") {
          throw new Error("decision must be approved or rejected");
        }
        const actor = readOptionalActor(params);
        await respondWrite(
          opts,
          actor,
          undefined,
          async () =>
            await store.mutate(
              (draft) => {
                const existing = draft.widgetsRegistry[name];
                draft.widgetsRegistry[name] = {
                  status: decision,
                  createdBy: existing?.createdBy ?? actor,
                  ...(decision === "approved"
                    ? { approvedBy: actor, approvedAt: new Date().toISOString() }
                    : {}),
                };
              },
              { actor },
            ),
        );
      } catch (error) {
        respondError(opts.respond, error);
      }
    },
    { scope: "write" },
  );

  host.registerRpc(
    "dashboard.capability.approve",
    async (opts) => {
      try {
        // Operator-only (SPEC §17): grant or revoke a connector's data/tool capability.
        // Not in the agent tool catalog and covered by OPERATOR_ONLY_METHODS, so an
        // agent or a networked client can never reach it — only the local operator.
        const params = readParams(opts.params, [
          "name",
          "decision",
          "actor",
          "tools",
          "autoConfirm",
          "expiresAt",
          "agents",
        ]);
        const name = readRequiredString(params, "name", "name");
        if (!CONNECTOR_NAME_PATTERN.test(name)) {
          throw new Error("name is invalid");
        }
        const decision = readRequiredString(params, "decision", "decision");
        if (decision !== "granted" && decision !== "revoked") {
          throw new Error("decision must be granted or revoked");
        }
        // Partial grant (SPEC §17.1): the operator may tick a SUBSET of the requested
        // `connector:tool` ids. The decision applies to the intersection with the
        // requested set; the granted subset gets its OWN anti-rug-pull hash.
        const toolsSubset = readToolsSubset(params);
        // Per-tool auto-confirm (SPEC §17.2, #62) + grant TTL (SPEC §17 TTLs, #64) — both
        // OPERATOR-ONLY, settable only here (this verb is in OPERATOR_ONLY_METHODS, never in
        // the agent catalog). autoConfirm is intersected with the granted tools below; a TTL
        // must be future-dated at write.
        const autoConfirmSubset = readAutoConfirmSubset(params);
        const expiresAt = readFutureExpiresAt(params, (options.now ?? Date.now)());
        // Per-agent scope (SPEC §17.3, #59) — OPERATOR-ONLY, settable only here. Absent
        // CLEARS any prior scope (undefined ⇒ dropped by the validator), so this verb is the
        // single writer; narrowing or widening it is legitimate operator intent (unlike the
        // agent/reconcile path, which re-pends on any scope drift).
        const agentsScope = readAgentsScope(params);
        const actor = readOptionalActor(params);
        await respondWrite(
          opts,
          actor,
          undefined,
          async () =>
            await store.mutate(
              (draft) => {
                const registry = (draft.capabilitiesRegistry ??= {});
                const existing = registry[name];
                if (!existing) {
                  throw new Error(`no capability request for connector: ${name}`);
                }
                if (decision === "revoked") {
                  // Revoke clears the operator-only auto-run + TTL + per-agent scope too
                  // (SPEC §17.2/§17 TTLs/§17.3): a revoked grant carries no active lease or
                  // scope.
                  registry[name] = {
                    ...existing,
                    status: "revoked",
                    grantedBy: undefined,
                    grantedAt: undefined,
                    autoConfirm: undefined,
                    expiresAt: undefined,
                    agents: undefined,
                  };
                  return;
                }
                // Granting a subset records ONLY that subset (intersection with the
                // requested `tools`) plus the subset's hash; approve-all (no `tools`
                // param) grants the full requested set unchanged.
                const grantedTools =
                  toolsSubset === undefined
                    ? existing.tools
                    : (existing.tools ?? []).filter((tool) => toolsSubset.includes(tool));
                const toolsHash =
                  toolsSubset === undefined
                    ? existing.toolsHash
                    : (options.capabilityToolsHash?.(name, grantedTools ?? []) ??
                      existing.toolsHash);
                // autoConfirm (SPEC §17.2, #62) must be a SUBSET of the tools actually being
                // granted — an id outside the granted set is rejected (an ungranted tool can
                // never auto-run). The approve verb is the sole writer: an absent param
                // CLEARS any prior auto-confirm (undefined ⇒ dropped by the validator).
                if (autoConfirmSubset !== undefined) {
                  if (new Set(autoConfirmSubset).size !== autoConfirmSubset.length) {
                    throw new Error("autoConfirm contains duplicate tool ids");
                  }
                  const granted = new Set(grantedTools ?? []);
                  for (const id of autoConfirmSubset) {
                    if (!granted.has(id)) {
                      throw new Error(`autoConfirm tool "${id}" is not in the granted set`);
                    }
                  }
                }
                registry[name] = {
                  ...existing,
                  status: "granted",
                  ...(grantedTools !== undefined ? { tools: grantedTools } : {}),
                  ...(toolsHash !== undefined ? { toolsHash } : { toolsHash: undefined }),
                  // Absent params CLEAR the prior value (undefined ⇒ dropped on validate) so
                  // this verb is the single source of truth for the operator-only fields.
                  autoConfirm: autoConfirmSubset,
                  expiresAt,
                  agents: agentsScope,
                  grantedBy: actor,
                  grantedAt: new Date((options.now ?? Date.now)()).toISOString(),
                };
              },
              { actor },
            ),
        );
      } catch (error) {
        respondError(opts.respond, error);
      }
    },
    { scope: "write" },
  );

  host.registerRpc(
    "dashboard.widget.install",
    async (opts) => {
      try {
        // SECURITY: this method takes the ALREADY-FETCHED bundle from the operator's
        // browser ({ name, manifest, files }) — it never receives or fetches a URL,
        // so there is no server-side network egress (no SSRF). installWidgetBundle
        // validates size + manifest + file paths, writes the files, and registers the
        // widget as `pending` (never approved — SPEC §8.2).
        const params = readParams(opts.params, ["name", "manifest", "files", "actor"]);
        const name = readRequiredString(params, "name", "name");
        if (!CUSTOM_WIDGET_NAME_PATTERN.test(name)) {
          throw new Error("name is invalid");
        }
        const actor = readOptionalActor(params);
        await respondWrite(opts, actor, undefined, async () => {
          if (!options.installWidgetBundle) {
            throw new Error("widget install requires the node host (@boardstate/server/node)");
          }
          return await options.installWidgetBundle(
            store,
            { name, manifest: params.manifest, files: params.files },
            { actor, stateDir: store.stateDir },
          );
        });
      } catch (error) {
        respondError(opts.respond, error);
      }
    },
    { scope: "write" },
  );

  host.registerRpc(
    "dashboard.workspace.replace",
    async (opts) => {
      try {
        const params = readParams(opts.params, ["doc", "actor"]);
        const actor = readOptionalActor(params);
        const doc = validateWorkspaceDoc(params.doc);
        // Untrusted entry point: replaceSanitized forbids elevating any custom
        // widget to `approved` (SPEC §8.2 / §11-I3) — approval is only via
        // dashboard.widget.approve. The agent tool additionally strips provenance.
        await respondWrite(
          opts,
          actor,
          undefined,
          async () => await store.replaceSanitized(doc, { actor }),
        );
      } catch (error) {
        respondError(opts.respond, error);
      }
    },
    { scope: "write" },
  );

  host.registerRpc(
    "dashboard.workspace.undo",
    async (opts) => {
      try {
        const params = readParams(opts.params, ["actor"]);
        const actor = readOptionalActor(params);
        const doc = await store.undo();
        broadcastChange(opts.broadcast, { doc, actor });
        respondDoc(opts, doc);
      } catch (error) {
        respondError(opts.respond, error);
      }
    },
    { scope: "write" },
  );

  host.registerRpc(
    "dashboard.workspace.history.list",
    async (opts) => {
      try {
        opts.respond(true, { entries: await store.listHistory() });
      } catch (error) {
        respondError(opts.respond, error);
      }
    },
    { scope: "read" },
  );

  host.registerRpc(
    "dashboard.workspace.history.get",
    async (opts) => {
      try {
        const params = readParams(opts.params, ["version"]);
        const doc = await store.getHistorySnapshot(readVersion(params));
        // A historical snapshot is a full workspace doc — it MUST pass the same
        // server-side visibility filter as a live response (SPEC §11-I6), or a
        // non-owner could read a private tab out of history.
        opts.respond(true, { doc: filterWorkspaceForOperator(doc, opts.operatorId) });
      } catch (error) {
        respondError(opts.respond, error);
      }
    },
    { scope: "read" },
  );

  host.registerRpc(
    "dashboard.data.read",
    async (opts) => {
      try {
        const params = readParams(opts.params, ["binding"]);
        const resolveData = options.resolveBinding ?? resolveBinding;
        opts.respond(true, {
          data: await resolveData(params.binding, options.dataRead),
        });
      } catch (error) {
        respondError(opts.respond, error);
      }
    },
    { scope: "read" },
  );

  host.registerRpc(
    "dashboard.presence.ping",
    (opts) => {
      try {
        const params = readParams(opts.params, ["tabSlug"]);
        const tabSlug = readSlug(params, "tabSlug");
        // Ephemeral presence (SPEC §5 surface): identity + tab only. Broadcast to
        // every client, NEVER persisted, and NEVER carrying document/state. Read
        // scope — presence adds no new write privilege.
        opts.broadcast("boardstate.presence", {
          operator: opts.operatorId ?? "operator",
          tabSlug,
          at: Date.now(),
        });
        opts.respond(true, { ok: true });
      } catch (error) {
        respondError(opts.respond, error);
      }
    },
    { scope: "read" },
  );

  // Widget write-back (SPEC §10). The TRUSTED PARENT (Control UI bridge) calls these
  // on a sandboxed widget's behalf with the widgetId it already tracks for that
  // iframe — the widget never reaches the control plane and never supplies its own
  // id. State lives under `state/<widgetId>.json`, jailed + size-capped in the store,
  // SEPARATE from the workspace document.
  host.registerRpc(
    "dashboard.widget.state.get",
    async (opts) => {
      try {
        const params = readParams(opts.params, ["widgetId"]);
        const widgetId = readWidgetId(params, "widgetId");
        const record = await store.readWidgetState(widgetId);
        opts.respond(
          true,
          record === null
            ? { state: null }
            : { state: record.blob, version: record.version, updatedAt: record.updatedAt },
        );
      } catch (error) {
        respondError(opts.respond, error);
      }
    },
    { scope: "read" },
  );

  host.registerRpc(
    "dashboard.widget.state.set",
    async (opts) => {
      try {
        const params = readParams(opts.params, ["widgetId", "state", "expectedVersion"]);
        const widgetId = readWidgetId(params, "widgetId");
        if (!Object.hasOwn(params, "state")) {
          throw new Error("state is required");
        }
        // Optional optimistic-concurrency guard: reject the write whole when the
        // caller's expected version no longer matches (two-browser lost-update case).
        let expectedVersion: number | undefined;
        if (params.expectedVersion !== undefined) {
          const raw = params.expectedVersion;
          if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
            throw new Error("expectedVersion must be a non-negative integer");
          }
          expectedVersion = raw;
        }
        // The blob is opaque to the control plane, but it must be JSON-serializable;
        // the store rejects an oversize serialization WHOLE (nothing written).
        const { version } = await store.writeWidgetState(widgetId, params.state as JsonValue, {
          expectedVersion,
        });
        // Minimal change marker: id + version only, NEVER the blob. Receivers refetch.
        opts.broadcast("boardstate.widget-state.changed", { widgetId, version });
        opts.respond(true, { widgetId, version });
      } catch (error) {
        respondError(opts.respond, error);
      }
    },
    { scope: "write" },
  );

  // Chat & agent-turn protocol (SPEC §14). Only wired when a host opts in with a
  // session store; `chat.send` is registered only when an agent loop is also provided
  // (a host without one leaves it unregistered so the wire rejects it — §14.1).
  if (options.chat) {
    registerChatRpc(host, { sessions: options.chat, chatAgent: options.chatAgent });
  }
}
