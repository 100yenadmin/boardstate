// Transport-backed controller for a Boardstate client: workspace load, the live
// `boardstate.changed` subscription, optimistic mutations with a fresher-doc-wins
// revert guard, client-side binding resolution (rpc/file/stream/computed), and
// workspace export/import. All control-plane calls go through the injected
// `Transport` (never a concrete gateway client).
//
// The pure read-model logic this drives — defensive `normalizeWorkspace`, tab
// resolution, JSON-pointer application — lives in `@boardstate/core`.

import {
  applyPointer,
  normalizeWorkspace,
  parseWorkspaceImport,
  resolveActiveSlug,
  sanitizeImportedWorkspace,
  serializeWorkspaceExport,
  workspaceDocFromPayload,
  workspaceExportFilename,
  type DashboardBinding,
  type DashboardBindingSource,
  type DashboardChangedEvent,
  type DashboardGridRect,
  type DashboardTabLayout,
  type DashboardWidget,
  type DashboardWorkspace,
  type Transport,
  type WorkspaceExportOptions,
} from "@boardstate/core";
import { isStreamEventAllowed } from "./bridge.js";
import { clearPresence } from "./presence.js";

/** Broadcast event the host emits on any workspace mutation (SPEC §5). */
const CHANGED_EVENT = "boardstate.changed";

export type DashboardUiState = {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  workspace: DashboardWorkspace | null;
  /** Slug of the workspace tab in view; null until the doc resolves a default. */
  activeSlug: string | null;
  /** Whether the hidden-tabs overflow menu is open. */
  hiddenMenuOpen: boolean;
  /** Widgets with an in-flight mutation, for optimistic-state affordances. */
  pendingWidgetIds: Set<string>;
  /** Transient error surfaced after a failed mutation (reverted state + toast). */
  actionError: string | null;
  requestUpdate: (() => void) | null;
};

type DashboardHost = object;

const dashboardStates = new WeakMap<DashboardHost, DashboardUiState>();
const dashboardEventUnsubscribers = new WeakMap<DashboardHost, () => void>();
const dashboardEventTransports = new WeakMap<DashboardHost, Transport>();
// Per-host data-refresh polling: a single interval per host that fires the view's
// tick (re-resolve data-widget bindings) only while the document is visible.
const dashboardPollTimers = new WeakMap<DashboardHost, ReturnType<typeof setInterval>>();
const dashboardPollActive = new WeakMap<DashboardHost, boolean>();

/** Default data-refresh interval (ms); the 30–60s window, floored at 10s. */
export const DASHBOARD_POLL_INTERVAL_MS = 45_000;
// Per-host teardown for an in-flight hand-rolled drag: the view registers window
// pointermove/pointerup listeners while dragging, so a tab-switch/disconnect that
// calls stopDashboard must cancel the drag (remove listeners, neutralize the
// pending pointerup) rather than leak closures over the now-stale view state.
const dashboardActiveDragCancel = new WeakMap<DashboardHost, () => void>();

/**
 * Register the teardown for an active drag on `host`. The view calls this when a
 * drag begins; `cancel` must remove its window listeners and make any later
 * pointerup a no-op. A previously registered drag is cancelled first so only one
 * drag is ever live per host.
 */
export function registerActiveDrag(host: DashboardHost, cancel: () => void): void {
  dashboardActiveDragCancel.get(host)?.();
  dashboardActiveDragCancel.set(host, cancel);
}

/** Clear the active-drag teardown for `host` once the drag settles normally. */
export function clearActiveDrag(host: DashboardHost): void {
  dashboardActiveDragCancel.delete(host);
}

/** Cancel any in-flight drag on `host` (used by stopDashboard and re-registration). */
export function cancelActiveDrag(host: DashboardHost): void {
  const cancel = dashboardActiveDragCancel.get(host);
  if (cancel) {
    dashboardActiveDragCancel.delete(host);
    cancel();
  }
}

export function getDashboardState(host: DashboardHost): DashboardUiState {
  let state = dashboardStates.get(host);
  if (!state) {
    state = {
      loading: false,
      loaded: false,
      error: null,
      workspace: null,
      activeSlug: null,
      hiddenMenuOpen: false,
      pendingWidgetIds: new Set(),
      actionError: null,
      requestUpdate: null,
    };
    dashboardStates.set(host, state);
  }
  return state;
}

function notify(state: DashboardUiState): void {
  state.requestUpdate?.();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return "Unknown dashboard error.";
}

/** Load the workspace document; seeds `activeSlug` from the requested deep-link slug. */
export async function loadWorkspace(
  state: DashboardUiState,
  transport: Transport | null,
  opts?: { requestedSlug?: string | null; silent?: boolean },
): Promise<void> {
  if (!transport) {
    return;
  }
  if (!opts?.silent) {
    state.loading = true;
    state.error = null;
    notify(state);
  }
  try {
    const payload = await transport.request("dashboard.workspace.get", {});
    const workspace = normalizeWorkspace(
      // dashboard.workspace.get responds { doc, workspaceVersion } — read `doc`
      // (a bare payload is tolerated for forward-compat).
      isRecord(payload) && "doc" in payload ? payload.doc : payload,
    );
    state.workspace = workspace;
    state.activeSlug = resolveActiveSlug(workspace, opts?.requestedSlug ?? state.activeSlug);
    state.error = null;
    state.loaded = true;
  } catch (err) {
    state.error = formatError(err);
  } finally {
    state.loading = false;
    notify(state);
  }
}

/**
 * Subscribe to `boardstate.changed` and refetch on a newer version (skips
 * stale/own-echo events by comparing `workspaceVersion`). The transport delivers
 * the event payload directly.
 */
export function subscribeToDashboardEvents(
  host: DashboardHost,
  state: DashboardUiState,
  transport: Transport | null,
): void {
  if (!transport) {
    stopDashboardEvents(host);
    return;
  }
  if (dashboardEventTransports.get(host) === transport) {
    return;
  }
  stopDashboardEvents(host);
  const unsubscribe = transport.addEventListener(CHANGED_EVENT, (raw: unknown) => {
    const payload = isRecord(raw) ? (raw as DashboardChangedEvent) : undefined;
    const incomingVersion = readNumber(payload?.workspaceVersion, Number.NaN);
    const currentVersion = state.workspace?.workspaceVersion ?? -1;
    // Skip our own echo / stale replays: only a strictly newer version refetches.
    if (Number.isFinite(incomingVersion) && incomingVersion <= currentVersion) {
      return;
    }
    void loadWorkspace(state, transport, { silent: true });
  });
  dashboardEventUnsubscribers.set(host, unsubscribe);
  dashboardEventTransports.set(host, transport);
}

export function stopDashboardEvents(host: DashboardHost): void {
  dashboardEventUnsubscribers.get(host)?.();
  dashboardEventUnsubscribers.delete(host);
  dashboardEventTransports.delete(host);
}

/**
 * Start (idempotently) the per-host data-refresh timer. The timer fires `onTick`
 * every `intervalMs`, but ONLY while the document is visible — a background tab
 * skips the tick so we don't hammer the gateway when nobody's watching. Passing a
 * null transport stops any running timer (disconnect). A second call with a live
 * transport is a no-op so re-renders don't stack timers.
 */
export function startBindingPolling(
  host: DashboardHost,
  transport: Transport | null,
  onTick: () => void,
  intervalMs: number = DASHBOARD_POLL_INTERVAL_MS,
): void {
  if (!transport) {
    stopBindingPolling(host);
    return;
  }
  if (dashboardPollActive.get(host)) {
    return;
  }
  const clamped = Math.max(10_000, intervalMs);
  const timer = setInterval(() => {
    // Visibility gate: only refresh when the tab is foreground. On a hidden tab
    // (or no-document env) we skip; the next visible render re-resolves.
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }
    onTick();
  }, clamped);
  dashboardPollTimers.set(host, timer);
  dashboardPollActive.set(host, true);
}

/** Stop the per-host data-refresh timer (tab-leave/disconnect). */
export function stopBindingPolling(host: DashboardHost): void {
  const timer = dashboardPollTimers.get(host);
  if (timer !== undefined) {
    clearInterval(timer);
    dashboardPollTimers.delete(host);
  }
  dashboardPollActive.delete(host);
}

/** Full lifecycle teardown for the client's `stop` hook. */
export function stopDashboard(host: DashboardHost): void {
  cancelActiveDrag(host);
  stopDashboardEvents(host);
  stopBindingPolling(host);
  clearPresence(host);
}

function replaceWidget(
  workspace: DashboardWorkspace,
  slug: string,
  widgetId: string,
  update: (widget: DashboardWidget) => DashboardWidget,
): DashboardWorkspace {
  return {
    ...workspace,
    tabs: workspace.tabs.map((tab) =>
      tab.slug !== slug
        ? tab
        : {
            ...tab,
            widgets: tab.widgets.map((widget) =>
              widget.id === widgetId ? update(widget) : widget,
            ),
          },
    ),
  };
}

function removeWidget(
  workspace: DashboardWorkspace,
  slug: string,
  widgetId: string,
): DashboardWorkspace {
  return {
    ...workspace,
    tabs: workspace.tabs.map((tab) =>
      tab.slug !== slug
        ? tab
        : { ...tab, widgets: tab.widgets.filter((widget) => widget.id !== widgetId) },
    ),
  };
}

/**
 * Run an optimistic mutation: apply `optimistic` locally, fire the RPC, and revert
 * to the pre-mutation snapshot on failure (surfacing `actionError` for a toast).
 * All shell mutations funnel through here so revert semantics stay consistent.
 */
async function optimisticMutation(
  state: DashboardUiState,
  transport: Transport | null,
  params: {
    widgetId: string;
    optimistic: (workspace: DashboardWorkspace) => DashboardWorkspace;
    method: string;
    rpcParams: Record<string, unknown>;
  },
): Promise<void> {
  if (!transport || !state.workspace) {
    return;
  }
  const previous = state.workspace;
  const optimistic = params.optimistic(previous);
  state.workspace = optimistic;
  state.pendingWidgetIds.add(params.widgetId);
  state.actionError = null;
  notify(state);
  try {
    await transport.request(params.method, params.rpcParams);
  } catch (err) {
    // Revert ONLY if we are still showing the exact optimistic doc we installed.
    // A concurrent loadWorkspace (e.g. a boardstate.changed refetch) may have landed
    // a FRESHER doc while the RPC was in flight; reverting to the stale pre-mutation
    // snapshot in that case would stomp the fresher state.
    if (state.workspace === optimistic) {
      state.workspace = previous;
    }
    state.actionError = formatError(err);
  } finally {
    state.pendingWidgetIds.delete(params.widgetId);
    notify(state);
  }
}

export function moveWidget(
  state: DashboardUiState,
  transport: Transport | null,
  params: { slug: string; widgetId: string; grid: DashboardGridRect },
): Promise<void> {
  return optimisticMutation(state, transport, {
    widgetId: params.widgetId,
    method: "dashboard.widget.move",
    rpcParams: { tab: params.slug, id: params.widgetId, grid: params.grid },
    optimistic: (workspace) =>
      replaceWidget(workspace, params.slug, params.widgetId, (widget) => ({
        ...widget,
        grid: params.grid,
      })),
  });
}

export function setWidgetCollapsed(
  state: DashboardUiState,
  transport: Transport | null,
  params: { slug: string; widgetId: string; collapsed: boolean },
): Promise<void> {
  return optimisticMutation(state, transport, {
    widgetId: params.widgetId,
    method: "dashboard.widget.update",
    rpcParams: { tab: params.slug, id: params.widgetId, patch: { collapsed: params.collapsed } },
    optimistic: (workspace) =>
      replaceWidget(workspace, params.slug, params.widgetId, (widget) => ({
        ...widget,
        collapsed: params.collapsed,
      })),
  });
}

export function updateWidgetTitle(
  state: DashboardUiState,
  transport: Transport | null,
  params: { slug: string; widgetId: string; title: string },
): Promise<void> {
  return optimisticMutation(state, transport, {
    widgetId: params.widgetId,
    method: "dashboard.widget.update",
    rpcParams: { tab: params.slug, id: params.widgetId, patch: { title: params.title } },
    optimistic: (workspace) =>
      replaceWidget(workspace, params.slug, params.widgetId, (widget) => ({
        ...widget,
        title: params.title,
      })),
  });
}

/**
 * Pin a temporary (ephemeral) Living Answer: clear its `ephemeral` flag so the
 * store's TTL sweep never removes it. Mirrors the other widget.update actions —
 * `ephemeral: null` is the clear signal the store's patch reader understands.
 */
export function pinWidget(
  state: DashboardUiState,
  transport: Transport | null,
  params: { slug: string; widgetId: string },
): Promise<void> {
  return optimisticMutation(state, transport, {
    widgetId: params.widgetId,
    method: "dashboard.widget.update",
    rpcParams: { tab: params.slug, id: params.widgetId, patch: { ephemeral: null } },
    optimistic: (workspace) =>
      replaceWidget(workspace, params.slug, params.widgetId, (widget) => {
        const { ephemeral: _ephemeral, ...rest } = widget;
        return rest;
      }),
  });
}

export function hideWidget(
  state: DashboardUiState,
  transport: Transport | null,
  params: { slug: string; widgetId: string },
): Promise<void> {
  return optimisticMutation(state, transport, {
    widgetId: params.widgetId,
    method: "dashboard.widget.update",
    rpcParams: { tab: params.slug, id: params.widgetId, patch: { hidden: true } },
    optimistic: (workspace) => removeWidget(workspace, params.slug, params.widgetId),
  });
}

export function removeWidgetFromTab(
  state: DashboardUiState,
  transport: Transport | null,
  params: { slug: string; widgetId: string },
): Promise<void> {
  return optimisticMutation(state, transport, {
    widgetId: params.widgetId,
    method: "dashboard.widget.remove",
    rpcParams: { tab: params.slug, id: params.widgetId },
    optimistic: (workspace) => removeWidget(workspace, params.slug, params.widgetId),
  });
}

export function moveWidgetToTab(
  state: DashboardUiState,
  transport: Transport | null,
  params: { fromSlug: string; toSlug: string; widgetId: string },
): Promise<void> {
  return optimisticMutation(state, transport, {
    widgetId: params.widgetId,
    method: "dashboard.widget.move",
    rpcParams: { tab: params.fromSlug, id: params.widgetId, toTab: params.toSlug },
    optimistic: (workspace) => {
      const source = workspace.tabs.find((tab) => tab.slug === params.fromSlug);
      const widget = source?.widgets.find((w) => w.id === params.widgetId);
      if (!widget) {
        return workspace;
      }
      return {
        ...workspace,
        tabs: workspace.tabs.map((tab) => {
          if (tab.slug === params.fromSlug) {
            return { ...tab, widgets: tab.widgets.filter((w) => w.id !== params.widgetId) };
          }
          if (tab.slug === params.toSlug) {
            return { ...tab, widgets: [...tab.widgets, widget] };
          }
          return tab;
        }),
      };
    },
  });
}

/**
 * Set a tab's content layout ("grid" | "full") → `dashboard.tab.update` (WRITE).
 * Optimistically flips the tab layout so the full-bleed toggle feels instant, then
 * reverts to the pre-mutation snapshot on failure (surfacing `actionError`). The
 * revert is guarded like the widget mutations so a concurrent refetch isn't stomped.
 */
export async function setTabLayout(
  state: DashboardUiState,
  transport: Transport | null,
  params: { slug: string; layout: DashboardTabLayout },
): Promise<void> {
  if (!transport || !state.workspace) {
    return;
  }
  const previous = state.workspace;
  const optimistic: DashboardWorkspace = {
    ...previous,
    tabs: previous.tabs.map((tab) =>
      tab.slug === params.slug ? { ...tab, layout: params.layout } : tab,
    ),
  };
  state.workspace = optimistic;
  state.actionError = null;
  notify(state);
  try {
    await transport.request("dashboard.tab.update", {
      slug: params.slug,
      patch: { layout: params.layout },
    });
  } catch (err) {
    if (state.workspace === optimistic) {
      state.workspace = previous;
    }
    state.actionError = formatError(err);
    notify(state);
  }
}

/**
 * Restore the most recent workspace snapshot via the EXISTING undo write path
 * (time-travel reuses `dashboard.workspace.undo`; no new write RPC). The resulting
 * `boardstate.changed` broadcast refetches, but we also reload eagerly so the caller
 * sees the reverted doc without waiting for the echo. A failure surfaces `actionError`.
 */
export async function undoWorkspace(
  state: DashboardUiState,
  transport: Transport | null,
): Promise<void> {
  if (!transport) {
    return;
  }
  state.actionError = null;
  notify(state);
  try {
    await transport.request("dashboard.workspace.undo", {});
    await loadWorkspace(state, transport, { silent: true });
  } catch (err) {
    state.actionError = formatError(err);
    notify(state);
  }
}

/**
 * Approve or reject a pending custom widget (operator-only) → `dashboard.widget.approve`
 * (WRITE). The registry is not part of the optimistic widget model, so this fires
 * the RPC and lets the resulting `boardstate.changed` broadcast refetch the new
 * status; a failure surfaces `actionError` for the toast.
 */
export async function approveWidget(
  state: DashboardUiState,
  transport: Transport | null,
  params: { name: string; decision: "approved" | "rejected" },
): Promise<void> {
  if (!transport) {
    return;
  }
  state.actionError = null;
  notify(state);
  try {
    await transport.request("dashboard.widget.approve", {
      name: params.name,
      decision: params.decision,
    });
  } catch (err) {
    state.actionError = formatError(err);
    notify(state);
  }
}

/**
 * Operator grant/revoke of a connector's data/tool capability (SPEC §17). A partial
 * grant (§17.1) passes the SUBSET of `connector:tool` ids the operator ticked; omitted
 * ⇒ approve-all (the full requested set).
 */
export async function approveCapability(
  state: DashboardUiState,
  transport: Transport | null,
  params: { name: string; decision: "granted" | "revoked"; tools?: string[] },
): Promise<void> {
  if (!transport) {
    return;
  }
  state.actionError = null;
  notify(state);
  try {
    await transport.request("dashboard.capability.approve", {
      name: params.name,
      decision: params.decision,
      ...(params.tools !== undefined ? { tools: params.tools } : {}),
    });
  } catch (err) {
    state.actionError = formatError(err);
    notify(state);
  }
}

// --- Workspace export / import (distribution) --------------------------------

export type WorkspaceExportFile = { filename: string; json: string };

/**
 * Fetch the strict workspace doc and serialize it (optionally a chosen tab subset)
 * for download. Reads the canonical `workspace.json` from the gateway so the export
 * round-trips through the write-time validator on re-import (the UI read model is
 * lossy). Throws when disconnected; the caller surfaces the failure.
 */
export async function exportWorkspace(
  transport: Transport | null,
  options: WorkspaceExportOptions = {},
): Promise<WorkspaceExportFile> {
  if (!transport) {
    throw new Error("Not connected.");
  }
  const payload = await transport.request("dashboard.workspace.get", {});
  const doc = workspaceDocFromPayload(payload);
  return { filename: workspaceExportFilename(), json: serializeWorkspaceExport(doc, options) };
}

/**
 * Import a workspace JSON file: parse, coerce every custom widget to `pending` (so
 * the approval gate runs — an import NEVER auto-approves), then apply via the
 * existing `dashboard.workspace.replace`, which RE-VALIDATES the doc server-side.
 * A parse or validation failure surfaces as an `actionError` toast; returns whether
 * the import applied.
 */
export async function importWorkspace(
  state: DashboardUiState,
  transport: Transport | null,
  text: string,
): Promise<boolean> {
  if (!transport) {
    return false;
  }
  state.actionError = null;
  notify(state);
  try {
    const doc = sanitizeImportedWorkspace(parseWorkspaceImport(text));
    await transport.request("dashboard.workspace.replace", { doc });
    // Refresh immediately rather than wait for the boardstate.changed echo.
    await loadWorkspace(state, transport, { silent: true });
    return true;
  } catch (err) {
    state.actionError = formatError(err);
    notify(state);
    return false;
  }
}

// --- Client-side binding resolution ------------------------------------------

export type DashboardBindingResult = { value: unknown } | { error: string };

/**
 * A binding as the client resolves it. Extends core's `DashboardBinding` read model
 * with the `stream`/`computed` sources and their fields (`event`/`op`/`inputs`/`arg`)
 * — see the store note: core's read model does not yet enumerate these, so they are
 * widened here at the resolution seam.
 */
export type ClientBinding = Omit<DashboardBinding, "source"> & {
  source: DashboardBindingSource | "stream" | "computed";
  event?: string;
  op?: string;
  inputs?: string[];
  arg?: string;
};

/**
 * Resolve a widget binding into a value the builtin renderers consume. Wire is:
 * - `static`: literal value from the binding.
 * - `rpc`: resolved CLIENT-SIDE on the page's own transport.
 * - `file`: served by `dashboard.data.read`; the JSON pointer is applied server-side.
 * - `stream`/`computed`: never a one-shot read (see `subscribeToStreamBinding` /
 *   `resolveComputedBinding`); guarded so a stream binding can never be mistaken for
 *   a `file` read against an empty path.
 *
 * `dashboard.data.read` serves file/static only and answers rpc bindings with
 * `{ code: "binding_client_resolved" }`, so rpc never routes through it.
 */
export async function resolveBinding(
  transport: Transport | null,
  binding: ClientBinding,
): Promise<DashboardBindingResult> {
  try {
    if (binding.source === "static") {
      return { value: binding.value };
    }
    if (!transport) {
      return { error: "Not connected." };
    }
    if (binding.source === "rpc") {
      if (!binding.method) {
        return { error: "Binding is missing an rpc method." };
      }
      const value = await transport.request(binding.method, binding.params ?? {});
      return { value: applyPointer(value, binding.pointer) };
    }
    if (binding.source === "stream") {
      return { error: "Stream bindings resolve via subscription, not a one-shot read." };
    }
    if (binding.source === "computed") {
      return { error: "Computed bindings resolve from sibling values, not a one-shot read." };
    }
    // file: `dashboard.data.read` accepts ONLY a `binding` param (its readParams
    // whitelist rejects anything else), and it resolves the file AND applies the
    // JSON pointer server-side, returning the final value under `data`. So we send
    // the whole binding and must NOT re-apply the pointer here (that would
    // double-resolve it).
    const payload = await transport.request("dashboard.data.read", { binding });
    return { value: isRecord(payload) && "data" in payload ? payload.data : payload };
  } catch (err) {
    return { error: formatError(err) };
  }
}

// --- `computed` binding resolution (client-side, no eval) --------------------

/** Recursively collect finite numbers from a value (numbers + nested arrays). */
function collectNumbers(value: unknown, out: number[]): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      collectNumbers(entry, out);
    }
  }
}

/** Count elements across an input value: an array contributes its length, a defined scalar 1. */
function countElements(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  return value === undefined || value === null ? 0 : 1;
}

/** Interpolate `{i}` placeholders in `template` with the i-th input value; no eval. */
function formatComputed(template: string, inputValues: unknown[]): string {
  return template.replace(/\{(\d+)\}/g, (_match, digits: string) => {
    const value = inputValues[Number(digits)];
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return String(value);
    }
    // null/undefined collapse to empty; objects/arrays (and any exotic type)
    // stringify to JSON — never rely on Object's default `[object Object]`.
    return value === undefined || value === null ? "" : (JSON.stringify(value) ?? "");
  });
}

/**
 * Resolve a `computed` binding CLIENT-SIDE from its already-resolved sibling input
 * values via a FIXED whitelisted op — a switch, never an expression language or
 * eval. `inputValues` are the resolved values of the binding's `inputs`, in order.
 * - `sum|avg|min|max`: reduce the finite numbers flattened out of the inputs
 *   (empty → `0` for sum, `null` for avg/min/max).
 * - `count`: total element count across the inputs (array → length).
 * - `last`: the last input's raw value.
 * - `pick`: the JSON pointer `arg` applied to the FIRST input.
 * - `format`: the template `arg` with `{i}` placeholders filled from the inputs.
 */
export function resolveComputedBinding(
  op: string,
  inputValues: unknown[],
  arg?: string,
): DashboardBindingResult {
  switch (op) {
    case "sum":
    case "avg":
    case "min":
    case "max": {
      const nums: number[] = [];
      for (const value of inputValues) {
        collectNumbers(value, nums);
      }
      if (op === "sum") {
        return { value: nums.reduce((total, n) => total + n, 0) };
      }
      if (nums.length === 0) {
        return { value: null };
      }
      if (op === "avg") {
        return { value: nums.reduce((total, n) => total + n, 0) / nums.length };
      }
      return { value: op === "min" ? Math.min(...nums) : Math.max(...nums) };
    }
    case "count":
      return { value: inputValues.reduce((total: number, v) => total + countElements(v), 0) };
    case "last":
      return { value: inputValues.length ? inputValues[inputValues.length - 1] : null };
    case "pick":
      return { value: applyPointer(inputValues[0], arg) };
    case "format":
      return { value: formatComputed(arg ?? "", inputValues) };
    default:
      return { error: `Unknown computed op: ${op}` };
  }
}

/**
 * Subscribe a `stream` binding to its allowlisted broadcast channel. Each event
 * payload pushes `applyPointer(payload, pointer)` to `onValue`; the returned fn
 * unsubscribes (call on unmount). This NEVER opens a socket — it multiplexes over
 * the transport's existing event stream via `addEventListener`. A missing transport
 * or a non-allowlisted event id subscribes to nothing (defense-in-depth over the
 * write-time schema gate), so a stream binding can never listen on an arbitrary
 * channel.
 */
export function subscribeToStreamBinding(
  transport: Transport | null,
  binding: ClientBinding,
  onValue: (result: DashboardBindingResult) => void,
): () => void {
  const event = binding.event;
  if (!transport || !event || !isStreamEventAllowed(event)) {
    return () => {};
  }
  return transport.addEventListener(event, (payload: unknown) => {
    try {
      onValue({ value: applyPointer(payload, binding.pointer) });
    } catch (err) {
      onValue({ error: formatError(err) });
    }
  });
}
