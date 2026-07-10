// `<boardstate-view>` — the reference Boardstate view as a custom element. The
// source was a set of host-keyed render functions with WeakMap view-state; this
// wraps them: the element IS the host object (the store/grid WeakMaps key off it),
// and the injected control-plane (`transport`) plus presentation seams (`strings`,
// `onNavigate`, `storage`, `confirm`, `embed`, `basePath`, `initialTab`) arrive as
// element properties. Grid/drag math and the workspace store come from
// `@boardstate/core` / `@boardstate/host`; nothing app-specific is imported.

import { LitElement, html, nothing, render, type TemplateResult } from "lit";
import {
  DASHBOARD_GRID_GAP,
  DASHBOARD_ROW_HEIGHT,
  beginDrag,
  buildWidgetApprovalsSource,
  collides,
  computeWorkspaceDiff,
  customWidgetName,
  customWidgetStatus,
  dashboardAgentProvenance,
  findTab,
  firstSeenVersion,
  gridPlacementStyle,
  gridRowCount,
  groupDiffByActor,
  groupTabsByActor,
  hiddenTabs,
  nudgeRect,
  orderedTabs,
  resolveActiveSlug,
  resolveDrop,
  updateDrag,
  visibleTabs,
  type DashboardBinding,
  type DashboardDragState,
  type DashboardGridRect,
  type DashboardHistoryEntry,
  type DashboardHistorySnapshot,
  type DashboardTab,
  type DashboardWidget,
  type DashboardWorkspace,
  type Transport,
  type WidgetManifestView,
} from "@boardstate/core";
import {
  approveWidget,
  clearActiveDrag,
  dispatchRateLimitedPrompt,
  exportWorkspace,
  fetchGalleryIndex,
  fetchWidgetBundle,
  getDashboardState,
  hideWidget,
  importWorkspace,
  installGalleryWidget,
  loadHistoryList,
  loadHistorySnapshot,
  loadWidgetManifestView,
  loadWorkspace,
  moveWidget,
  moveWidgetToTab,
  pinWidget,
  pingPresence,
  presenceForTab,
  registerActiveDrag,
  removeWidgetFromTab,
  resolveBinding,
  resolveComputedBinding,
  setTabLayout,
  setWidgetCollapsed,
  startBindingPolling,
  stopDashboard,
  subscribeToDashboardEvents,
  subscribeToStreamBinding,
  undoWorkspace,
  updateWidgetTitle,
  type ClientBinding,
  type DashboardBindingResult,
  type DashboardUiState,
  type GalleryBundle,
  type GalleryEntry,
} from "@boardstate/host";
import { CHAT_EVENT, type AgentStreamEvent } from "@boardstate/schema";
import {
  renderWidgetBody,
  renderWidgetCell,
  type DashboardCustomWidgetContext,
  type DashboardWidgetBlame,
  type DashboardWidgetCellCallbacks,
} from "./boardstate-widget-cell.js";
import { icons } from "./icons.js";
import type { BuiltinWidgetContext } from "./renderers/index.js";
import { setBoardstateStrings, t, type BoardstateStrings } from "./strings.js";

/** Minimal Web-Storage-shaped seam for the onboarding-dismissed flag. */
export interface BoardstateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Embed policy for the iframe-embed builtin (generalized from the app config). */
export interface BoardstateEmbedPolicy {
  sandboxMode: "strict" | "scripts";
  allowExternalUrls: boolean;
}

/** Injection surface for the reference view. */
export type BoardstateViewProps = {
  /** The host object the store/grid WeakMaps key on (the element itself). */
  host: object;
  /** Control-plane transport; null while disconnected. */
  transport: Transport | null;
  /** Whether the transport is live (gates load/subscribe/poll). */
  connected: boolean;
  onRequestUpdate?: () => void;
  /** String overrides (merged over the English defaults). */
  strings?: BoardstateStrings;
  /** Called with a tab slug when the operator selects a workspace tab. */
  onNavigate?: (slug: string) => void;
  /** Storage seam for the onboarding-dismissed flag. */
  storage?: BoardstateStorage;
  /** Confirm dialog for custom-widget prompt dispatch; resolves true to send. */
  confirm?: (text: string) => Promise<boolean> | boolean;
  /** Embed policy (defaults to strict / no external URLs). */
  embed?: BoardstateEmbedPolicy;
  /** HTTP base path for custom-widget iframe assets. */
  basePath?: string;
  /** Initial active tab slug (deep-link seed); the app owns URL parsing. */
  initialTab?: string | null;
  /** Session key for custom-widget prompt dispatch. */
  sessionKey?: string;
  /**
   * Deep link to an external logbook/history surface, or null when unavailable
   * (m2 blame). The blame line links here for agent-authored widgets only; the
   * embedder resolves the URL.
   */
  logbookHref?: string | null;
};

const DEFAULT_EMBED: BuiltinWidgetContext["embed"] = {
  embedSandboxMode: "strict",
  allowExternalEmbedUrls: false,
};

function embedContext(policy: BoardstateEmbedPolicy | undefined): BuiltinWidgetContext["embed"] {
  if (!policy) {
    return DEFAULT_EMBED;
  }
  return { embedSandboxMode: policy.sandboxMode, allowExternalEmbedUrls: policy.allowExternalUrls };
}

// Per-host transient view state (menu, live drag) kept outside the data model so a
// broadcast refetch never clobbers an open menu or an in-flight drag.
type DashboardViewState = {
  openMenuWidgetId: string | null;
  drag: DashboardDragState | null;
  bindingResults: Map<string, DashboardBindingResult>;
  bindingLoads: Set<string>;
  bindingVersion: number;
  /**
   * Live `stream`-binding subscriptions keyed by widgetId. Reconciled against the
   * active tab by `workspaceVersion` (NOT the poll counter — a poll tick must never
   * churn a live subscription), torn down on tab-leave/disconnect/stop.
   */
  streamSubs: Map<string, StreamSubscription>;
  /** Last value pushed by each stream subscription; survives poll-tick cache clears. */
  streamValues: Map<string, DashboardBindingResult>;
  manifestCache: Map<string, WidgetManifestView>;
  manifestLoads: Set<string>;
  dataVersion: number;
  dialog: DashboardDialogState | null;
  onboardingDismissed: boolean;
  /** Collapsed per-agent tab groups (w4), keyed by group key. Transient. */
  collapsedTabGroups: Set<string>;
  /** Last tab slug a presence heartbeat was sent for (w4); dedupes pings. */
  lastPresenceSlug: string | null;
  /** Workspace time-travel panel state (m2). */
  history: DashboardHistoryViewState;
  /** Widget-gallery browse/install surface state (w3), or null when closed. */
  gallery: DashboardGalleryState | null;
};

/** Bookkeeping for one live `stream`-binding subscription (see DashboardViewState). */
type StreamSubscription = {
  workspaceVersion: number;
  event: string;
  pointer?: string;
  unsubscribe: () => void;
};

/**
 * Time-travel panel state (m2). Read-only: `entries` is the ring metadata and
 * `snapshots` caches loaded snapshot bodies by version (shared with the blame
 * line's first-seen lookup). Restore reuses the existing undo write path.
 */
type DashboardHistoryViewState = {
  open: boolean;
  loading: boolean;
  error: string | null;
  entries: DashboardHistoryEntry[];
  snapshots: Map<number, DashboardWorkspace>;
  selectedVersion: number | null;
  confirmRestore: boolean;
  restoring: boolean;
};

function initialHistoryViewState(): DashboardHistoryViewState {
  return {
    open: false,
    loading: false,
    error: null,
    entries: [],
    snapshots: new Map(),
    selectedVersion: null,
    confirmRestore: false,
    restoring: false,
  };
}

/**
 * Widget-gallery dialog state (w3). The registry URL is operator-entered (persisted
 * in the injected storage; never a hardcoded remote). `entries` holds the browsed
 * index; `selected` is a client-fetched bundle awaiting the operator's install
 * confirmation (which surfaces the requested capabilities first).
 */
type DashboardGalleryState = {
  indexUrl: string;
  entries: GalleryEntry[] | null;
  selected: GalleryBundle | null;
  busy: boolean;
  error: string | null;
};

/** Storage key remembering the operator's last registry index URL (w3). */
const GALLERY_URL_KEY = "boardstate:gallery-url:v1";

function readGalleryUrl(storage: BoardstateStorage | undefined): string {
  try {
    return storage?.getItem(GALLERY_URL_KEY) ?? "";
  } catch {
    return "";
  }
}

function persistGalleryUrl(storage: BoardstateStorage | undefined, url: string): void {
  try {
    storage?.setItem(GALLERY_URL_KEY, url);
  } catch {
    // Best effort — remembering the URL is a convenience, not a product failure.
  }
}

/** Shape one gallery fetch/install error into a display string. */
function formatGalleryError(err: unknown): string {
  return err instanceof Error && err.message.trim() ? err.message.trim() : "Widget gallery error.";
}

/** localStorage flag so the first-visit onboarding banner stays dismissed across reloads. */
const ONBOARDING_DISMISS_KEY = "boardstate:onboarding-dismissed:v1";

function isOnboardingDismissed(storage: BoardstateStorage | undefined): boolean {
  try {
    return storage?.getItem(ONBOARDING_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function persistOnboardingDismissed(storage: BoardstateStorage | undefined): void {
  try {
    storage?.setItem(ONBOARDING_DISMISS_KEY, "1");
  } catch {
    // Best effort — dismissing the hint is not a product failure.
  }
}

/** Themed-dialog state replacing the old window.prompt() flows. */
type DashboardDialogState =
  | { kind: "editTitle"; slug: string; widgetId: string; title: string }
  | { kind: "moveToTab"; slug: string; widgetId: string };

const dashboardViewStates = new WeakMap<object, DashboardViewState>();

// Per-host document dismiss listener for the open kebab menu. Installed while a menu
// is open so an outside pointerdown or Escape closes it.
type MenuDismissBinding = {
  onPointerDown: (event: PointerEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
};
const dashboardMenuDismiss = new WeakMap<object, MenuDismissBinding>();

function teardownMenuDismiss(host: object): void {
  const binding = dashboardMenuDismiss.get(host);
  if (!binding) {
    return;
  }
  document.removeEventListener("pointerdown", binding.onPointerDown, true);
  document.removeEventListener("keydown", binding.onKeyDown, true);
  dashboardMenuDismiss.delete(host);
}

function syncMenuDismiss(
  host: object,
  viewState: DashboardViewState,
  requestUpdate: () => void,
): void {
  const menuOpen = viewState.openMenuWidgetId !== null;
  const active = dashboardMenuDismiss.has(host);
  if (menuOpen === active) {
    return;
  }
  if (!menuOpen) {
    teardownMenuDismiss(host);
    return;
  }
  const close = () => {
    if (viewState.openMenuWidgetId === null) {
      return;
    }
    viewState.openMenuWidgetId = null;
    teardownMenuDismiss(host);
    requestUpdate();
  };
  const onPointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(".dashboard-widget__menu, .dashboard-widget__menu-toggle")
    ) {
      return;
    }
    close();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  dashboardMenuDismiss.set(host, { onPointerDown, onKeyDown });
}

/** View-level teardown: drop menu-dismiss listeners + live stream subscriptions. */
export function stopBoardstateView(host: object): void {
  teardownMenuDismiss(host);
  teardownStreamSubscriptions(host);
}

/** Unsubscribe every live `stream` binding for `host` (tab-leave / disconnect / stop). */
function teardownStreamSubscriptions(host: object): void {
  const viewState = dashboardViewStates.get(host);
  if (!viewState) {
    return;
  }
  for (const sub of viewState.streamSubs.values()) {
    sub.unsubscribe();
  }
  viewState.streamSubs.clear();
}

function getViewState(host: object, storage: BoardstateStorage | undefined): DashboardViewState {
  let state = dashboardViewStates.get(host);
  if (!state) {
    state = {
      openMenuWidgetId: null,
      drag: null,
      bindingResults: new Map(),
      bindingLoads: new Set(),
      bindingVersion: -1,
      streamSubs: new Map(),
      streamValues: new Map(),
      manifestCache: new Map(),
      manifestLoads: new Set(),
      dataVersion: 0,
      dialog: null,
      onboardingDismissed: isOnboardingDismissed(storage),
      collapsedTabGroups: new Set(),
      lastPresenceSlug: null,
      history: initialHistoryViewState(),
      gallery: null,
    };
    dashboardViewStates.set(host, state);
  }
  return state;
}

/** Read the current data-refresh counter for a host (used by the poll timer). */
export function boardstateDataVersion(host: object): number {
  return dashboardViewStates.get(host)?.dataVersion ?? 0;
}

/** Advance the data-refresh counter so the next render re-resolves bindings. */
export function bumpBoardstateDataVersion(host: object): void {
  const state = dashboardViewStates.get(host);
  if (state) {
    state.dataVersion += 1;
  }
}

/** Primary binding for a widget (first declared), if any. */
function primaryBinding(widget: DashboardWidget): DashboardBinding | null {
  const bindings = widget.bindings;
  if (!bindings) {
    return null;
  }
  const first = Object.values(bindings)[0];
  return first ?? null;
}

/**
 * Cache key mixing the workspace version with the data-refresh counter: a doc
 * change OR a poll tick both invalidate resolved bindings. Overflow-safe.
 */
function bindingCacheKey(workspace: DashboardWorkspace, viewState: DashboardViewState): number {
  return workspace.workspaceVersion * 1_000_003 + viewState.dataVersion;
}

/**
 * Reconcile live `stream`-binding subscriptions against the active tab's widgets.
 * Keyed by `workspaceVersion` so a poll tick never churns subscriptions; a doc
 * change (or an event/pointer change) re-subscribes. A null transport (disconnect)
 * tears every subscription down. Each pushed value lands in both `streamValues`
 * (survives poll-tick cache clears) and `bindingResults` (the render cache).
 */
function reconcileStreamSubscriptions(
  viewState: DashboardViewState,
  transport: Transport | null,
  workspace: DashboardWorkspace,
  tab: DashboardTab,
  requestUpdate: (() => void) | null,
): void {
  if (!transport) {
    for (const sub of viewState.streamSubs.values()) {
      sub.unsubscribe();
    }
    viewState.streamSubs.clear();
    return;
  }
  const wanted = new Map<string, ClientBinding>();
  for (const widget of tab.widgets) {
    const binding = primaryBinding(widget) as ClientBinding | null;
    if (binding?.source === "stream" && binding.event) {
      wanted.set(widget.id, binding);
    }
  }
  // Drop subscriptions no longer wanted, or whose channel/doc-version changed.
  for (const [widgetId, sub] of viewState.streamSubs) {
    const binding = wanted.get(widgetId);
    if (
      !binding ||
      sub.workspaceVersion !== workspace.workspaceVersion ||
      sub.event !== binding.event ||
      sub.pointer !== binding.pointer
    ) {
      sub.unsubscribe();
      viewState.streamSubs.delete(widgetId);
      viewState.streamValues.delete(widgetId);
    }
  }
  // Establish subscriptions for newly-wanted stream widgets.
  for (const [widgetId, binding] of wanted) {
    if (viewState.streamSubs.has(widgetId)) {
      continue;
    }
    const unsubscribe = subscribeToStreamBinding(transport, binding, (result) => {
      viewState.streamValues.set(widgetId, result);
      viewState.bindingResults.set(widgetId, result);
      requestUpdate?.();
    });
    viewState.streamSubs.set(widgetId, {
      workspaceVersion: workspace.workspaceVersion,
      event: binding.event as string,
      ...(binding.pointer !== undefined ? { pointer: binding.pointer } : {}),
      unsubscribe,
    });
  }
}

/**
 * Resolve a `computed` primary binding from its sibling `inputs`: resolve each
 * named input (leaf bindings only — the schema forbids computed→computed) then
 * derive the value via the whitelisted op. Stream inputs are not one-shot
 * resolvable and surface an error (computed reads settled values, not live pushes).
 */
async function resolveComputedForWidget(
  transport: Transport | null,
  widget: DashboardWidget,
  binding: ClientBinding,
): Promise<DashboardBindingResult> {
  const siblings = widget.bindings ?? {};
  const values: unknown[] = [];
  for (const name of binding.inputs ?? []) {
    const input = siblings[name];
    if (!input) {
      return { error: `Computed input not found: ${name}` };
    }
    const result = await resolveBinding(transport, input);
    if ("error" in result) {
      return { error: result.error };
    }
    values.push(result.value);
  }
  return resolveComputedBinding(binding.op ?? "", values, binding.arg);
}

/** Kick off binding resolution for widgets on the active tab; cache per version. */
function ensureBindings(
  viewState: DashboardViewState,
  transport: Transport | null,
  workspace: DashboardWorkspace,
  tab: DashboardTab,
  requestUpdate: (() => void) | null,
): void {
  const key = bindingCacheKey(workspace, viewState);
  if (viewState.bindingVersion !== key) {
    viewState.bindingResults.clear();
    viewState.bindingLoads.clear();
    viewState.bindingVersion = key;
  }
  // Live stream subscriptions are managed out-of-band from the poll cache above.
  reconcileStreamSubscriptions(viewState, transport, workspace, tab, requestUpdate);

  for (const widget of tab.widgets) {
    const binding = primaryBinding(widget) as ClientBinding | null;
    if (
      !binding ||
      viewState.bindingResults.has(widget.id) ||
      viewState.bindingLoads.has(widget.id)
    ) {
      continue;
    }
    if (binding.source === "stream") {
      // Push-driven: seed the render cache with the last streamed value (if any);
      // the subscription reconciled above refreshes it on each pushed event.
      const streamed = viewState.streamValues.get(widget.id);
      if (streamed) {
        viewState.bindingResults.set(widget.id, streamed);
      }
      continue;
    }
    viewState.bindingLoads.add(widget.id);
    const pending =
      binding.source === "computed"
        ? resolveComputedForWidget(transport, widget, binding)
        : resolveBinding(transport, binding);
    void pending.then((result) => {
      viewState.bindingResults.set(widget.id, result);
      viewState.bindingLoads.delete(widget.id);
      requestUpdate?.();
    });
  }
}

function gridMetrics(host: object): { width: number } {
  const grid =
    host instanceof HTMLElement ? host.querySelector<HTMLElement>(".dashboard-grid") : null;
  return { width: grid?.clientWidth ?? 0 };
}

/** Close the hidden-tabs overflow `<details>` on Escape. */
function onHiddenTabsKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") {
    return;
  }
  const details = (event.currentTarget as HTMLElement).closest("details");
  if (details?.open) {
    event.preventDefault();
    details.open = false;
    (details.querySelector("summary") as HTMLElement | null)?.focus();
  }
}

/** Arm a one-shot outside-click that closes the hidden-tabs overflow. */
function onHiddenTabsToggle(event: Event): void {
  const details = event.currentTarget as HTMLDetailsElement;
  if (!details.open) {
    return;
  }
  const onOutside = (pointerEvent: PointerEvent) => {
    if (pointerEvent.target instanceof Node && details.contains(pointerEvent.target)) {
      return;
    }
    details.open = false;
    document.removeEventListener("pointerdown", onOutside, true);
  };
  const onClosed = () => {
    if (!details.open) {
      document.removeEventListener("pointerdown", onOutside, true);
      details.removeEventListener("toggle", onClosed);
    }
  };
  document.addEventListener("pointerdown", onOutside, true);
  details.addEventListener("toggle", onClosed);
}

/**
 * First-visit onboarding banner teaching how to add a tab. Dismissible +
 * persisted — and only shown while the workspace is genuinely unfurnished
 * (no widgets anywhere): a seeded/composed board doesn't need teaching.
 */
function renderOnboardingBanner(
  props: BoardstateViewProps,
  viewState: DashboardViewState,
  workspace: DashboardWorkspace,
  requestUpdate: () => void,
): TemplateResult | typeof nothing {
  if (viewState.onboardingDismissed) {
    return nothing;
  }
  if (workspace.tabs.some((tab) => tab.widgets.length > 0)) {
    return nothing;
  }
  const dismiss = () => {
    viewState.onboardingDismissed = true;
    persistOnboardingDismissed(props.storage);
    requestUpdate();
  };
  return html`
    <div class="dashboard-onboarding" role="note" data-test-id="dashboard-onboarding">
      <span class="dashboard-onboarding__icon" aria-hidden="true">${icons.spark}</span>
      <div class="dashboard-onboarding__body">
        <div class="dashboard-onboarding__title">${t("dashboard.onboarding.title")}</div>
        <div class="dashboard-onboarding__sub">${t("dashboard.onboarding.primary")}</div>
        <div class="dashboard-onboarding__sub">
          ${t("dashboard.onboarding.secondary")}
          <code class="dashboard-onboarding__cmd">${t("dashboard.empty.onboardingCommand")}</code>
        </div>
      </div>
      <button
        class="dashboard-onboarding__dismiss"
        type="button"
        data-test-id="dashboard-onboarding-dismiss"
        aria-label=${t("common.dismiss")}
        @click=${dismiss}
      >
        ${icons.x}
      </button>
    </div>
  `;
}

function selectTab(
  props: BoardstateViewProps,
  state: DashboardUiState,
  workspace: DashboardWorkspace,
  slug: string,
): void {
  state.activeSlug = resolveActiveSlug(workspace, slug);
  props.onNavigate?.(slug);
  props.onRequestUpdate?.();
}

/** Inline lock glyph for the private-tab marker (w4); icons.ts carries no lock. */
function lockGlyph(): TemplateResult {
  return html`<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
  </svg>`;
}

/**
 * "Who's viewing this tab" indicator (w4): a live dot plus a count when more than
 * one other operator is present. Rendered only when someone else is viewing — a
 * solo operator sees no presence chrome.
 */
function renderTabPresence(viewers: number): TemplateResult | typeof nothing {
  if (viewers <= 0) {
    return nothing;
  }
  const label = t("dashboard.tabs.presence", { count: String(viewers) });
  return html`
    <span
      class="dashboard-tab__presence"
      data-test-id="dashboard-tab-presence"
      title=${label}
      aria-label=${label}
    >
      <span class="dashboard-tab__presence-dot" aria-hidden="true"></span>
      ${viewers > 1 ? html`<span class="dashboard-tab__presence-count">${viewers}</span>` : nothing}
    </span>
  `;
}

/** One tab button in the strip. */
function renderTabButton(
  props: BoardstateViewProps,
  state: DashboardUiState,
  workspace: DashboardWorkspace,
  tab: DashboardTab,
  active: boolean,
  viewers = 0,
): TemplateResult {
  return html`
    <button
      class="dashboard-tab ${active ? "dashboard-tab--active" : ""}"
      type="button"
      role="tab"
      aria-selected=${active ? "true" : "false"}
      data-test-id="dashboard-tab"
      data-ws=${tab.slug}
      @click=${() => selectTab(props, state, workspace, tab.slug)}
    >
      ${
        tab.icon && Object.hasOwn(icons, tab.icon)
          ? html`<span class="dashboard-tab__icon" aria-hidden="true"
              >${icons[tab.icon as keyof typeof icons]}</span
            >`
          : nothing
      }
      <span class="dashboard-tab__label">${tab.title}</span>
      ${
        tab.visibility === "private"
          ? html`<span
              class="dashboard-tab__private"
              data-test-id="dashboard-tab-private"
              title=${t("dashboard.tabs.private")}
              aria-label=${t("dashboard.tabs.private")}
              >${lockGlyph()}</span
            >`
          : nothing
      }
      ${renderTabPresence(viewers)}
    </button>
  `;
}

/** Human label for an actor group header (w4). */
function tabGroupLabel(group: ReturnType<typeof groupTabsByActor>[number]): string {
  if (group.kind === "agent") {
    return t("dashboard.tabs.groupAgent", { agent: group.agentId ?? "agent" });
  }
  return group.kind === "system" ? t("dashboard.tabs.groupSystem") : t("dashboard.tabs.groupUser");
}

/**
 * Per-agent nesting (w4): render the visible tabs grouped by their `createdBy`
 * provenance, each group foldable via a collapse toggle. When every visible tab
 * shares one actor (the common case) the strip stays flat with no group chrome,
 * preserving the single-workspace UX. Presence dots come from the host's presence
 * store.
 */
function renderTabStrip(
  props: BoardstateViewProps,
  state: DashboardUiState,
  viewState: DashboardViewState,
  workspace: DashboardWorkspace,
): TemplateResult {
  const requestUpdate = () => props.onRequestUpdate?.();
  const tabs = visibleTabs(workspace);
  const groups = groupTabsByActor(tabs);
  const hidden = hiddenTabs(workspace);
  const grouped = groups.length > 1;
  const viewersOf = (slug: string): number => presenceForTab(props.host, slug).length;
  return html`
    <nav class="dashboard-tabs" role="tablist" aria-label=${t("dashboard.tabs.label")}>
      ${
        grouped
          ? groups.map((group) => {
              const collapsed = viewState.collapsedTabGroups.has(group.key);
              const toggle = () => {
                if (collapsed) {
                  viewState.collapsedTabGroups.delete(group.key);
                } else {
                  viewState.collapsedTabGroups.add(group.key);
                }
                requestUpdate();
              };
              const label = tabGroupLabel(group);
              return html`
                <div
                  class="dashboard-tab-group ${collapsed ? "dashboard-tab-group--collapsed" : ""}"
                  data-test-id="dashboard-tab-group"
                  data-group=${group.key}
                >
                  <button
                    class="dashboard-tab-group__toggle"
                    type="button"
                    data-test-id="dashboard-tab-group-toggle"
                    aria-expanded=${collapsed ? "false" : "true"}
                    aria-label=${
                      collapsed
                        ? t("dashboard.tabs.expandGroup", { group: label })
                        : t("dashboard.tabs.collapseGroup", { group: label })
                    }
                    @click=${toggle}
                  >
                    <span class="dashboard-tab-group__chevron" aria-hidden="true"
                      >${collapsed ? icons.chevronRight : icons.chevronDown}</span
                    >
                    <span class="dashboard-tab-group__label">${label}</span>
                    <span class="dashboard-tab-group__count">${group.tabs.length}</span>
                  </button>
                  ${
                    collapsed
                      ? nothing
                      : group.tabs.map((tab) =>
                          renderTabButton(
                            props,
                            state,
                            workspace,
                            tab,
                            tab.slug === state.activeSlug,
                            viewersOf(tab.slug),
                          ),
                        )
                  }
                </div>
              `;
            })
          : tabs.map((tab) =>
              renderTabButton(
                props,
                state,
                workspace,
                tab,
                tab.slug === state.activeSlug,
                viewersOf(tab.slug),
              ),
            )
      }
      ${
        hidden.length > 0
          ? html`
              <details
                class="dashboard-tabs__hidden"
                @toggle=${onHiddenTabsToggle}
                @keydown=${onHiddenTabsKeydown}
              >
                <summary class="dashboard-tab dashboard-tab--overflow">
                  <span class="dashboard-tab__icon" aria-hidden="true">${icons.eyeOff}</span>
                  <span class="dashboard-tab__label"
                    >${t("dashboard.tabs.hidden", { count: String(hidden.length) })}</span
                  >
                </summary>
                <div class="dashboard-tabs__hidden-menu" role="menu">
                  ${hidden.map(
                    (tab) => html`
                      <button
                        class="dashboard-tabs__hidden-item"
                        type="button"
                        role="menuitem"
                        @click=${() => selectTab(props, state, workspace, tab.slug)}
                      >
                        ${tab.title}
                      </button>
                    `,
                  )}
                </div>
              </details>
            `
          : nothing
      }
    </nav>
  `;
}

/** Load `widget.json` manifests for the APPROVED custom widgets on the active tab. */
function ensureManifests(
  viewState: DashboardViewState,
  props: BoardstateViewProps,
  workspace: DashboardWorkspace,
  tab: DashboardTab,
): void {
  const basePath = props.basePath ?? "";
  for (const widget of tab.widgets) {
    const name = customWidgetName(widget.kind);
    if (
      !name ||
      customWidgetStatus(workspace, widget.kind) !== "approved" ||
      viewState.manifestCache.has(name) ||
      viewState.manifestLoads.has(name)
    ) {
      continue;
    }
    viewState.manifestLoads.add(name);
    void loadWidgetManifestView(basePath, name).then((manifest) => {
      viewState.manifestLoads.delete(name);
      if (manifest) {
        viewState.manifestCache.set(name, manifest);
        props.onRequestUpdate?.();
      }
    });
  }
}

/**
 * Wire the action-form builtin's prompt dispatch to the shared confirm + rate-limit
 * gate — the SAME `dispatchRateLimitedPrompt` the custom-widget bridge uses, with the
 * same `confirm` fallback and the same `chat.send` path. No new privilege.
 */
function makeBuiltinDispatchPrompt(
  props: BoardstateViewProps,
): NonNullable<BuiltinWidgetContext["dispatchPrompt"]> {
  const transport = props.transport;
  const sessionKey = props.sessionKey ?? "main";
  return ({ widgetKey, text }) =>
    dispatchRateLimitedPrompt({
      widgetKey,
      text,
      confirmPrompt: async (prompt) => {
        if (props.confirm) {
          return await props.confirm(prompt);
        }
        return typeof window !== "undefined" ? window.confirm(prompt) : false;
      },
      sendPrompt: async (prompt) => {
        if (!transport) {
          throw new Error("Not connected.");
        }
        await transport.request("chat.send", { sessionKey, message: prompt, deliver: false });
      },
    });
}

/**
 * Builds the builtin-widget context for ONE widget. The write-back `state` accessor
 * is bound to THIS widget's own `widget.id` (host-tracked, never child-supplied), so
 * a stateful builtin (notes) can only read/write its own state; it is present only
 * when a transport exists. `dispatchPrompt` (action-form) and `approvals` are the
 * shared, workspace-scoped seams.
 */
function buildBuiltinContext(
  props: BoardstateViewProps,
  state: DashboardUiState,
  workspace: DashboardWorkspace,
  widget: DashboardWidget,
): BuiltinWidgetContext {
  const transport = props.transport;
  const context: BuiltinWidgetContext = {
    embed: embedContext(props.embed),
    dispatchPrompt: makeBuiltinDispatchPrompt(props),
    // A rejected action-form dispatch surfaces on the same shared toast as
    // export/import failures (the `state.actionError` banner).
    onActionError: (message) => {
      state.actionError = message;
      props.onRequestUpdate?.();
    },
    // The approvals builtin resolves pending widget approvals through the same
    // `dashboard.widget.approve` path the custom-widget pending card uses.
    approvals: buildWidgetApprovalsSource(
      workspace,
      (name, decision) => void approveWidget(state, transport, { name, decision }),
    ),
    // The chat builtin's inline approval card reads the live pending set (re-supplied
    // on every doc change) and resolves through the same approve path.
    registryPending: pendingWidgetNames(workspace),
  };
  if (transport) {
    context.state = createBuiltinStateAccessor(transport, widget.id);
    context.chat = makeBuiltinChatSeam(transport, props.sessionKey ?? "main");
    context.approveWidget = (name, decision) =>
      void approveWidget(state, transport, { name, decision });
  }
  return context;
}

/** Names of `custom:` widgets currently `pending` approval (chat inline approval card). */
function pendingWidgetNames(workspace: DashboardWorkspace): string[] {
  return Object.entries(workspace.widgetsRegistry)
    .filter(([, entry]) => entry.status === "pending")
    .map(([name]) => name);
}

/**
 * Build the `builtin:chat` control-plane seam (SPEC §14): all four `chat.*` methods
 * bound to a single `sessionKey`, with the broadcast bus (`CHAT_EVENT`) and the
 * history ring filtered to that key. The renderer knows nothing about providers —
 * this seam is the whole coupling to the control plane.
 */
function makeBuiltinChatSeam(
  transport: Transport,
  sessionKey: string,
): NonNullable<BuiltinWidgetContext["chat"]> {
  const belongsToSession = (event: AgentStreamEvent): boolean => event.sessionKey === sessionKey;
  return {
    send: async (message) => {
      const result = (await transport.request("chat.send", { sessionKey, message })) as {
        turnId: string;
      };
      return { turnId: result.turnId };
    },
    abort: async (turnId) => {
      await transport.request("chat.abort", { sessionKey, turnId });
    },
    history: async () => {
      const result = (await transport.request("chat.history.get", { sessionKey })) as {
        events?: AgentStreamEvent[];
      };
      return (result.events ?? []).filter(belongsToSession);
    },
    subscribe: (listener) =>
      transport.addEventListener(CHAT_EVENT, (payload: unknown) => {
        const event = payload as AgentStreamEvent;
        if (event && belongsToSession(event)) {
          listener(event);
        }
      }),
  };
}

/** Widget-id-bound write-back accessor over the transport (notes builtin). */
function createBuiltinStateAccessor(
  transport: Transport,
  widgetId: string,
): NonNullable<BuiltinWidgetContext["state"]> {
  return {
    get: () =>
      transport.request("dashboard.widget.state.get", { widgetId }) as Promise<{
        state: unknown;
        version?: number;
      }>,
    set: (blob) =>
      transport.request("dashboard.widget.state.set", {
        widgetId,
        state: blob,
      }) as Promise<{ version: number }>,
  };
}

/** Builds the custom-widget context for one `custom:<name>` widget, or null. */
function buildCustomContext(
  props: BoardstateViewProps,
  state: DashboardUiState,
  viewState: DashboardViewState,
  workspace: DashboardWorkspace,
  widget: DashboardWidget,
  tabSlug: string,
): DashboardCustomWidgetContext | null {
  const name = customWidgetName(widget.kind);
  if (!name) {
    return null;
  }
  return {
    status: customWidgetStatus(workspace, widget.kind),
    manifest: viewState.manifestCache.get(name) ?? null,
    host: {
      transport: props.transport,
      basePath: props.basePath ?? "",
      sessionKey: props.sessionKey ?? "main",
      // Tab identity for the pub/sub broker: scopes this widget's publishes and
      // subscriptions to its own tab. Host-tracked, never child-supplied.
      tabSlug,
      ...(props.confirm ? { confirmPrompt: props.confirm } : {}),
    },
    onApprove: () => void approveWidget(state, props.transport, { name, decision: "approved" }),
    onReject: () => void approveWidget(state, props.transport, { name, decision: "rejected" }),
  };
}

/** Loaded snapshot bodies as an ordered list, for the blame first-seen lookup (m2). */
function loadedHistorySnapshots(viewState: DashboardViewState): DashboardHistorySnapshot[] {
  return [...viewState.history.snapshots.entries()].map(([version, workspace]) => ({
    version,
    workspace,
  }));
}

/**
 * Build the blame line for a widget (m2), or undefined when it carries no
 * provenance. The first-seen version is recovered from whatever history snapshots
 * are already loaded (the panel loads them); the logbook link is offered only for
 * agent authors when a link is derivable.
 */
function computeWidgetBlame(
  props: BoardstateViewProps,
  viewState: DashboardViewState,
  widget: DashboardWidget,
): DashboardWidgetBlame | undefined {
  const actor = widget.createdBy;
  if (!actor) {
    return undefined;
  }
  const agentId = dashboardAgentProvenance(actor);
  const seen = firstSeenVersion(widget.id, loadedHistorySnapshots(viewState));
  return {
    actor,
    agentId,
    ...(seen !== undefined ? { firstSeenVersion: seen } : {}),
    ...(agentId ? { logbookHref: props.logbookHref ?? null } : {}),
  };
}

/** Fetch (or refetch) the ring metadata and auto-select the newest snapshot (m2). */
async function refreshHistoryList(
  props: BoardstateViewProps,
  viewState: DashboardViewState,
): Promise<void> {
  const requestUpdate = () => props.onRequestUpdate?.();
  const history = viewState.history;
  history.loading = true;
  history.error = null;
  requestUpdate();
  try {
    const entries = await loadHistoryList(props.transport);
    history.entries = entries;
    if (entries.length > 0 && history.selectedVersion === null) {
      history.selectedVersion = entries[0]!.version;
    }
    history.error = null;
  } catch (err) {
    history.error = err instanceof Error ? err.message : String(err);
  } finally {
    history.loading = false;
    requestUpdate();
  }
  if (history.selectedVersion !== null) {
    await ensureHistorySnapshot(props, viewState, history.selectedVersion);
  }
}

/** Lazily load one snapshot body into the per-host cache (m2). */
async function ensureHistorySnapshot(
  props: BoardstateViewProps,
  viewState: DashboardViewState,
  version: number,
): Promise<void> {
  const history = viewState.history;
  if (history.snapshots.has(version)) {
    return;
  }
  try {
    const workspace = await loadHistorySnapshot(props.transport, version);
    if (workspace) {
      history.snapshots.set(version, workspace);
      props.onRequestUpdate?.();
    }
  } catch (err) {
    history.error = err instanceof Error ? err.message : String(err);
    props.onRequestUpdate?.();
  }
}

/** Open the time-travel panel and load the ring (m2). */
function openHistory(props: BoardstateViewProps, viewState: DashboardViewState): void {
  viewState.history.open = true;
  viewState.history.confirmRestore = false;
  void refreshHistoryList(props, viewState);
  props.onRequestUpdate?.();
}

/** Close the time-travel panel; loaded snapshots stay cached for the blame line (m2). */
function closeHistory(props: BoardstateViewProps, viewState: DashboardViewState): void {
  viewState.history.open = false;
  viewState.history.confirmRestore = false;
  props.onRequestUpdate?.();
}

/** Select a history version, loading its body on demand (m2). */
function selectHistoryVersion(
  props: BoardstateViewProps,
  viewState: DashboardViewState,
  version: number,
): void {
  viewState.history.selectedVersion = version;
  void ensureHistorySnapshot(props, viewState, version);
  props.onRequestUpdate?.();
}

/** Grid rect for a freshly-installed widget: a default cell below existing rows (w3). */
function installPlacementGrid(
  tab: DashboardTab | undefined,
  bundle: GalleryBundle,
): DashboardGridRect {
  const manifest = bundle.manifest as { preferredSize?: unknown };
  const preferred =
    manifest.preferredSize && typeof manifest.preferredSize === "object"
      ? (manifest.preferredSize as { w?: unknown; h?: unknown })
      : {};
  const w = Math.min(12, Math.max(1, Number(preferred.w) || 6));
  const h = Math.max(1, Number(preferred.h) || 4);
  const y = (tab?.widgets ?? []).reduce((max, widget) => {
    const bottom = widget.grid.y + widget.grid.h;
    return bottom > max ? bottom : max;
  }, 0);
  return { x: 0, y, w, h };
}

function renderGrid(
  props: BoardstateViewProps,
  state: DashboardUiState,
  viewState: DashboardViewState,
  workspace: DashboardWorkspace,
  tab: DashboardTab,
): TemplateResult {
  ensureBindings(viewState, props.transport, workspace, tab, props.onRequestUpdate ?? null);
  ensureManifests(viewState, props, workspace, tab);
  if (tab.widgets.length === 0) {
    return html`
      <div class="dashboard-empty dashboard-empty--tab" data-test-id="dashboard-empty-tab">
        <span class="dashboard-empty__icon" aria-hidden="true">${icons.plus}</span>
        <div class="dashboard-empty__title">${t("dashboard.empty.tabTitle")}</div>
        <div class="dashboard-empty__sub">${t("dashboard.empty.tabSubtitle")}</div>
      </div>
    `;
  }
  if (tab.layout === "full") {
    return renderFullBleed(props, state, viewState, workspace, tab);
  }
  const callbacks = makeCallbacks(props, state, viewState, tab);
  const rows = gridRowCount(tab.widgets);
  const minHeight = rows * DASHBOARD_ROW_HEIGHT + Math.max(0, rows - 1) * DASHBOARD_GRID_GAP;
  return html`
    <div class="dashboard-grid" style="min-height: ${minHeight}px" data-test-id="dashboard-grid">
      ${tab.widgets.map((widget) => {
        const custom = buildCustomContext(props, state, viewState, workspace, widget, tab.slug);
        const blame = computeWidgetBlame(props, viewState, widget);
        const drag = viewState.drag;
        const dragging = drag?.widgetId === widget.id;
        // Move drags carry the card 1:1 with the pointer (Mac-style direct
        // manipulation); resize keeps the card in place and previews via the ghost.
        const dragTransform =
          dragging && drag.mode === "move"
            ? `translate(${drag.pointerDx}px, ${drag.pointerDy}px)`
            : undefined;
        return renderWidgetCell({
          widget,
          binding: viewState.bindingResults.get(widget.id) ?? null,
          ...(blame ? { blame } : {}),
          menuOpen: viewState.openMenuWidgetId === widget.id,
          pending: state.pendingWidgetIds.has(widget.id),
          dragging,
          ...(dragTransform ? { dragTransform } : {}),
          builtinContext: buildBuiltinContext(props, state, workspace, widget),
          callbacks,
          ...(custom ? { custom } : {}),
        });
      })}
      ${renderDragGhost(viewState, tab)}
    </div>
  `;
}

/**
 * Full-bleed layout (w3): render the tab's FIRST widget filling the whole content
 * area with no grid chrome (no placement styles, no drag/resize handles). The
 * widget body reuses the same builtin/custom render path (and per-cell error
 * boundary) as the grid, so bindings, the sandboxed iframe host, and the approval
 * gate all behave identically — only the surrounding layout differs.
 */
function renderFullBleed(
  props: BoardstateViewProps,
  state: DashboardUiState,
  viewState: DashboardViewState,
  workspace: DashboardWorkspace,
  tab: DashboardTab,
): TemplateResult {
  const widget = tab.widgets[0]!;
  const callbacks = makeCallbacks(props, state, viewState, tab);
  const custom = buildCustomContext(props, state, viewState, workspace, widget, tab.slug);
  return html`
    <div class="dashboard-fullbleed" data-test-id="dashboard-fullbleed" data-widget-id=${widget.id}>
      ${renderWidgetBody(
        widget,
        viewState.bindingResults.get(widget.id) ?? null,
        buildBuiltinContext(props, state, workspace, widget),
        callbacks,
        custom ?? undefined,
      )}
    </div>
  `;
}

/** Snapped drop-target ghost for the active move/resize drag. */
function renderDragGhost(
  viewState: DashboardViewState,
  tab: DashboardTab,
): TemplateResult | typeof nothing {
  const drag = viewState.drag;
  if (!drag) {
    return nothing;
  }
  const invalid = collides(drag.ghostRect, tab.widgets, drag.widgetId);
  return html`
    <div
      class="dashboard-ghost ${invalid ? "dashboard-ghost--invalid" : ""}"
      style=${gridPlacementStyle(drag.ghostRect)}
      aria-hidden="true"
      data-test-id="dashboard-drag-ghost"
    ></div>
  `;
}

function makeCallbacks(
  props: BoardstateViewProps,
  state: DashboardUiState,
  viewState: DashboardViewState,
  tab: DashboardTab,
): DashboardWidgetCellCallbacks {
  const requestUpdate = () => props.onRequestUpdate?.();
  const commitDrag = (widget: DashboardWidget, event: PointerEvent, mode: "move" | "resize") => {
    const metrics = gridMetrics(props.host);
    if (metrics.width <= 0) {
      return;
    }
    const drag = beginDrag({
      widget,
      mode,
      clientX: event.clientX,
      clientY: event.clientY,
      metrics,
    });
    viewState.drag = drag;
    const target = event.target as Element;
    try {
      target.setPointerCapture?.(event.pointerId);
    } catch {
      // A pointer that vanished between pointerdown and capture (pen lift,
      // synthetic events) must not kill the drag wiring below.
    }
    let settled = false;
    const teardown = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    const cancel = () => {
      if (settled) {
        return;
      }
      settled = true;
      teardown();
      viewState.drag = null;
      requestUpdate();
    };
    const onMove = (moveEvent: PointerEvent) => {
      updateDrag(drag, moveEvent.clientX, moveEvent.clientY);
      requestUpdate();
    };
    const onUp = () => {
      if (settled) {
        return;
      }
      settled = true;
      teardown();
      clearActiveDrag(props.host);
      const resolved = resolveDrop({
        requested: drag.ghostRect,
        widgets: tab.widgets,
        widgetId: widget.id,
      });
      viewState.drag = null;
      requestUpdate();
      if (
        resolved &&
        (resolved.x !== widget.grid.x ||
          resolved.y !== widget.grid.y ||
          resolved.w !== widget.grid.w ||
          resolved.h !== widget.grid.h)
      ) {
        void moveWidget(state, props.transport, {
          slug: tab.slug,
          widgetId: widget.id,
          grid: resolved,
        });
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    registerActiveDrag(props.host, cancel);
  };
  return {
    onToggleCollapse: (widget) =>
      void setWidgetCollapsed(state, props.transport, {
        slug: tab.slug,
        widgetId: widget.id,
        collapsed: !widget.collapsed,
      }),
    onToggleMenu: (widget) => {
      viewState.openMenuWidgetId = viewState.openMenuWidgetId === widget.id ? null : widget.id;
      requestUpdate();
    },
    onHide: (widget) => {
      viewState.openMenuWidgetId = null;
      void hideWidget(state, props.transport, { slug: tab.slug, widgetId: widget.id });
    },
    onRemove: (widget) => {
      viewState.openMenuWidgetId = null;
      void removeWidgetFromTab(state, props.transport, { slug: tab.slug, widgetId: widget.id });
    },
    onEditTitle: (widget) => {
      viewState.openMenuWidgetId = null;
      viewState.dialog = {
        kind: "editTitle",
        slug: tab.slug,
        widgetId: widget.id,
        title: widget.title,
      };
      requestUpdate();
    },
    onMoveToTab: (widget) => {
      viewState.openMenuWidgetId = null;
      viewState.dialog = { kind: "moveToTab", slug: tab.slug, widgetId: widget.id };
      requestUpdate();
    },
    onPin: (widget) => {
      viewState.openMenuWidgetId = null;
      // Clearing the ephemeral flag makes a temporary Living Answer permanent (pin).
      void pinWidget(state, props.transport, { slug: tab.slug, widgetId: widget.id });
    },
    onMovePointerDown: (widget, event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      commitDrag(widget, event, "move");
    },
    onResizePointerDown: (widget, event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      commitDrag(widget, event, "resize");
    },
    onKeyboardNudge: (widget, mode, direction) => {
      const next = nudgeRect(widget.grid, mode, direction);
      const resolved = resolveDrop({ requested: next, widgets: tab.widgets, widgetId: widget.id });
      if (resolved) {
        void moveWidget(state, props.transport, {
          slug: tab.slug,
          widgetId: widget.id,
          grid: resolved,
        });
      }
    },
  };
}

/** Minimal themed modal (Escape/backdrop cancel) replacing window.prompt() flows. */
function renderModal(label: string, onCancel: () => void, body: TemplateResult): TemplateResult {
  const onBackdrop = (event: MouseEvent) => {
    if (event.target === event.currentTarget) {
      onCancel();
    }
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };
  return html`
    <div
      class="bs-modal"
      role="dialog"
      aria-modal="true"
      aria-label=${label}
      data-test-id="bs-modal"
      @click=${onBackdrop}
      @keydown=${onKeydown}
    >
      <div class="bs-modal__card">${body}</div>
    </div>
  `;
}

/** Themed edit-title / move-to-tab dialog, replacing window.prompt(). */
function renderDialog(
  props: BoardstateViewProps,
  state: DashboardUiState,
  viewState: DashboardViewState,
): TemplateResult | typeof nothing {
  const dialog = viewState.dialog;
  if (!dialog) {
    return nothing;
  }
  const requestUpdate = () => props.onRequestUpdate?.();
  const close = () => {
    viewState.dialog = null;
    requestUpdate();
  };

  if (dialog.kind === "editTitle") {
    const title = t("dashboard.widget.editTitleTitle");
    const submit = (event: Event) => {
      event.preventDefault();
      const input = (event.currentTarget as HTMLElement).querySelector<HTMLInputElement>(
        "input[name='dashboard-widget-title']",
      );
      const next = input?.value.trim() ?? "";
      if (next && next !== dialog.title) {
        void updateWidgetTitle(state, props.transport, {
          slug: dialog.slug,
          widgetId: dialog.widgetId,
          title: next,
        });
      }
      close();
    };
    return renderModal(
      title,
      close,
      html`
        <form class="bs-dialog" @submit=${submit}>
          <div class="bs-dialog__title">${title}</div>
          <input
            class="bs-dialog__input"
            type="text"
            name="dashboard-widget-title"
            data-test-id="dashboard-edit-title-input"
            .value=${dialog.title}
            aria-label=${t("dashboard.widget.editTitleLabel")}
          />
          <div class="bs-dialog__actions">
            <button class="bs-btn bs-btn--primary" type="submit">${t("common.save")}</button>
            <button class="bs-btn" type="button" @click=${close}>${t("common.cancel")}</button>
          </div>
        </form>
      `,
    );
  }

  const title = t("dashboard.widget.moveToTabTitle");
  const targets = state.workspace
    ? orderedTabs(state.workspace).filter((candidate) => candidate.slug !== dialog.slug)
    : [];
  const submit = (event: Event) => {
    event.preventDefault();
    const select = (event.currentTarget as HTMLElement).querySelector<HTMLSelectElement>(
      "select[name='dashboard-move-target']",
    );
    const toSlug = select?.value ?? "";
    if (toSlug && toSlug !== dialog.slug) {
      void moveWidgetToTab(state, props.transport, {
        fromSlug: dialog.slug,
        toSlug,
        widgetId: dialog.widgetId,
      });
    }
    close();
  };
  return renderModal(
    title,
    close,
    html`
      <form class="bs-dialog" @submit=${submit}>
        <div class="bs-dialog__title">${title}</div>
        ${
          targets.length === 0
            ? html`<div class="bs-dialog__sub">${t("dashboard.widget.moveToTabEmpty")}</div>`
            : html`<select
                class="bs-dialog__input"
                name="dashboard-move-target"
                data-test-id="dashboard-move-target"
                aria-label=${title}
              >
                ${targets.map(
                  (candidate) => html`<option value=${candidate.slug}>${candidate.title}</option>`,
                )}
              </select>`
        }
        <div class="bs-dialog__actions">
          <button class="bs-btn bs-btn--primary" type="submit" ?disabled=${targets.length === 0}>
            ${t("dashboard.widget.menu.moveToTab")}
          </button>
          <button class="bs-btn" type="button" @click=${close}>${t("common.cancel")}</button>
        </div>
      </form>
    `,
  );
}

/**
 * Render the reference view for `props`. The element owns lifecycle (load /
 * subscribe / poll) via the host store, keyed on `props.host`.
 */
export function renderBoardstateView(props: BoardstateViewProps): TemplateResult {
  setBoardstateStrings(props.strings);
  const state = getDashboardState(props.host);
  const viewState = getViewState(props.host, props.storage);
  state.requestUpdate = props.onRequestUpdate ?? null;
  syncMenuDismiss(props.host, viewState, () => props.onRequestUpdate?.());

  const active = props.connected;
  subscribeToDashboardEvents(props.host, state, active ? props.transport : null);
  startBindingPolling(props.host, active ? props.transport : null, () => {
    bumpBoardstateDataVersion(props.host);
    // Presence heartbeat (w4): re-announce the tab in view each tick so a still-
    // present operator doesn't age out of others' indicators.
    if (active && state.activeSlug) {
      pingPresence(props.host, props.transport, state.activeSlug);
    }
    props.onRequestUpdate?.();
  });
  if (active && !state.loaded && !state.loading && !state.error) {
    void loadWorkspace(state, props.transport, { requestedSlug: props.initialTab ?? null });
  }

  // Announce the tab in view once per activation (w4); the poll tick keeps the
  // heartbeat alive thereafter.
  if (active && state.activeSlug && viewState.lastPresenceSlug !== state.activeSlug) {
    viewState.lastPresenceSlug = state.activeSlug;
    pingPresence(props.host, props.transport, state.activeSlug);
  }

  return html`
    <section class="dashboard" data-test-id="dashboard">
      ${
        state.actionError
          ? html`<div class="callout danger dashboard__toast" role="alert">
              ${state.actionError}
            </div>`
          : nothing
      }
      ${renderBody(props, state, viewState)} ${renderDialog(props, state, viewState)}
      ${renderHistoryPanel(props, state, viewState)} ${renderGalleryDialog(props, state, viewState)}
    </section>
  `;
}

function renderBody(
  props: BoardstateViewProps,
  state: DashboardUiState,
  viewState: DashboardViewState,
): TemplateResult {
  if (state.error) {
    return html`
      <div class="card lazy-view-state" role="alert">
        <div class="card-title">${t("dashboard.error.title")}</div>
        <div class="card-sub">${t("dashboard.error.subtitle")}</div>
        <details class="dashboard-error-detail">
          <summary>${t("dashboard.error.detailSummary")}</summary>
          <div class="dashboard-error-detail__text">${state.error}</div>
        </details>
        <button
          class="bs-btn bs-btn--small"
          type="button"
          @click=${() => void loadWorkspace(state, props.transport)}
        >
          ${t("common.reload")}
        </button>
      </div>
    `;
  }
  const workspace = state.workspace;
  if (!workspace) {
    return html`
      <div class="dashboard-skeleton" role="status" aria-label=${t("common.loading")}>
        ${[0, 1, 2, 3, 4, 5].map(() => html`<div class="dashboard-skeleton__card"></div>`)}
      </div>
    `;
  }
  if (workspace.tabs.length === 0) {
    return html`
      <div class="dashboard-empty dashboard-empty--onboarding" data-test-id="dashboard-empty">
        <div class="dashboard-empty__title">${t("dashboard.empty.onboardingTitle")}</div>
        <div class="dashboard-empty__sub">${t("dashboard.empty.onboardingSubtitle")}</div>
        <code class="dashboard-empty__cmd">${t("dashboard.empty.onboardingCommand")}</code>
      </div>
    `;
  }
  const tab = findTab(workspace, state.activeSlug) ?? visibleTabs(workspace)[0];
  if (!tab) {
    return html`<div class="card lazy-view-state" role="status">
      <div class="card-sub">${t("dashboard.empty.noVisibleTabs")}</div>
    </div>`;
  }
  return html`
    ${renderWorkspacesHeader(props, state, viewState, tab)}
    ${renderOnboardingBanner(props, viewState, workspace, () => props.onRequestUpdate?.())}
    ${renderTabStrip(props, state, viewState, workspace)}
    ${renderGrid(props, state, viewState, workspace, tab)}
  `;
}

/** Trigger a browser download of `json` under `filename` (no-op outside a document). */
function downloadWorkspaceJson(filename: string, json: string): void {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    return;
  }
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Export the full workspace to a downloadable JSON file; a failure surfaces a toast (w5). */
function runWorkspaceExport(props: BoardstateViewProps, state: DashboardUiState): void {
  void exportWorkspace(props.transport)
    .then((file) => downloadWorkspaceJson(file.filename, file.json))
    .catch((err: unknown) => {
      state.actionError = err instanceof Error ? err.message : String(err);
      props.onRequestUpdate?.();
    });
}

/** Read the chosen file and apply it via importWorkspace (custom widgets → pending) (w5). */
function onWorkspaceImportChange(
  props: BoardstateViewProps,
  state: DashboardUiState,
  event: Event,
): void {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  // Reset so re-selecting the same file re-fires change.
  input.value = "";
  if (!file) {
    return;
  }
  void file.text().then((text) => importWorkspace(state, props.transport, text));
}

/** Open the widget gallery dialog seeded with the remembered registry URL (w3). */
function openGallery(props: BoardstateViewProps, viewState: DashboardViewState): void {
  viewState.gallery = {
    indexUrl: readGalleryUrl(props.storage),
    entries: null,
    selected: null,
    busy: false,
    error: null,
  };
  props.onRequestUpdate?.();
}

/**
 * Page-header treatment for the active workspace tab. Carries the tab-level actions:
 * the widget-gallery opener + full-bleed toggle (w3), the time-travel toggle (m2),
 * and the export/import distribution controls (w5).
 */
function renderWorkspacesHeader(
  props: BoardstateViewProps,
  state: DashboardUiState,
  viewState: DashboardViewState,
  tab: DashboardTab,
): TemplateResult {
  const isFull = tab.layout === "full";
  const toggleLayout = () =>
    void setTabLayout(state, props.transport, {
      slug: tab.slug,
      layout: isFull ? "grid" : "full",
    });
  return html`
    <div class="dashboard-page-header" data-test-id="dashboard-page-header">
      <div class="dashboard-page-header__titles">
        <div class="page-title">${tab.title}</div>
        <div class="page-sub">${t("dashboard.header.subtitle")}</div>
      </div>
      <div
        class="dashboard-page-header__actions dashboard-toolbar"
        data-test-id="dashboard-toolbar"
      >
        <button
          class="bs-btn bs-btn--small"
          type="button"
          data-test-id="dashboard-gallery-open"
          title=${t("dashboard.gallery.open")}
          @click=${() => openGallery(props, viewState)}
        >
          <span class="dashboard-page-header__action-icon" aria-hidden="true">${icons.puzzle}</span>
          ${t("dashboard.gallery.open")}
        </button>
        <button
          class="bs-btn bs-btn--small ${isFull ? "bs-btn--primary" : ""}"
          type="button"
          data-test-id="dashboard-fullbleed-toggle"
          aria-pressed=${isFull ? "true" : "false"}
          title=${isFull ? t("dashboard.header.fullBleedExit") : t("dashboard.header.fullBleedEnter")}
          @click=${toggleLayout}
        >
          <span class="dashboard-page-header__action-icon" aria-hidden="true"
            >${isFull ? icons.minimize : icons.maximize}</span
          >
          ${isFull ? t("dashboard.header.fullBleedExit") : t("dashboard.header.fullBleedEnter")}
        </button>
        <button
          class="bs-btn bs-btn--small dashboard-history__toggle"
          type="button"
          data-test-id="dashboard-history-toggle"
          @click=${() => openHistory(props, viewState)}
        >
          ${icons.clock} ${t("dashboard.history.open")}
        </button>
        <button
          class="bs-btn bs-btn--small"
          type="button"
          data-test-id="dashboard-export"
          title=${t("dashboard.distribution.exportTitle")}
          @click=${() => runWorkspaceExport(props, state)}
        >
          ${t("dashboard.distribution.export")}
        </button>
        <button
          class="bs-btn bs-btn--small"
          type="button"
          data-test-id="dashboard-import"
          title=${t("dashboard.distribution.importTitle")}
          @click=${(event: Event) =>
            (event.currentTarget as HTMLElement).parentElement
              ?.querySelector<HTMLInputElement>('input[type="file"]')
              ?.click()}
        >
          ${t("dashboard.distribution.import")}
        </button>
        <input
          type="file"
          accept="application/json,.json"
          hidden
          data-test-id="dashboard-import-input"
          @change=${(event: Event) => onWorkspaceImportChange(props, state, event)}
        />
      </div>
    </div>
  `;
}

/** Compact relative time for a history entry's ISO timestamp (m2, view-local). */
function formatRelativeTimestamp(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return iso;
  }
  const seconds = Math.round((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
      new Date(ms),
    );
  } catch {
    return iso;
  }
}

/**
 * Read-only time-travel panel (m2): the version list on the left, a selected
 * snapshot's preview + diff-vs-current + restore on the right. Restore reuses the
 * existing single-step undo, so it is offered only for the newest snapshot.
 */
function renderHistoryPanel(
  props: BoardstateViewProps,
  state: DashboardUiState,
  viewState: DashboardViewState,
): TemplateResult | typeof nothing {
  const history = viewState.history;
  if (!history.open) {
    return nothing;
  }
  const title = t("dashboard.history.title");
  const selected =
    history.selectedVersion !== null ? history.snapshots.get(history.selectedVersion) : undefined;
  const newestVersion = history.entries[0]?.version ?? null;
  return renderModal(
    title,
    () => closeHistory(props, viewState),
    html`
      <div class="dashboard-history" data-test-id="dashboard-history">
        <div class="dashboard-history__header">
          <div class="card-title">${title}</div>
          <div class="card-sub">${t("dashboard.history.subtitle")}</div>
        </div>
        ${
          history.error
            ? html`<div class="callout danger" role="alert">${history.error}</div>`
            : nothing
        }
        <div class="dashboard-history__body">
          ${renderHistoryList(props, viewState, newestVersion)}
          <div class="dashboard-history__detail">
            ${
              history.selectedVersion === null
                ? html`<div class="card-sub">${t("dashboard.history.emptyDetail")}</div>`
                : renderHistoryDetail(props, state, viewState, history.selectedVersion, selected)
            }
          </div>
        </div>
        <div class="bs-dialog__actions">
          <button class="bs-btn" type="button" @click=${() => closeHistory(props, viewState)}>
            ${t("common.close")}
          </button>
        </div>
      </div>
    `,
  );
}

function renderHistoryList(
  props: BoardstateViewProps,
  viewState: DashboardViewState,
  newestVersion: number | null,
): TemplateResult {
  const history = viewState.history;
  if (history.loading && history.entries.length === 0) {
    return html`<div class="dashboard-history__list">
      <div class="card-sub">${t("common.loading")}</div>
    </div>`;
  }
  if (history.entries.length === 0) {
    return html`<div class="dashboard-history__list">
      <div class="card-sub">${t("dashboard.history.empty")}</div>
    </div>`;
  }
  return html`
    <ul class="dashboard-history__list" role="listbox" aria-label=${t("dashboard.history.title")}>
      ${history.entries.map((entry) => {
        const active = entry.version === history.selectedVersion;
        return html`
          <li>
            <button
              class="dashboard-history__item ${active ? "dashboard-history__item--active" : ""}"
              type="button"
              role="option"
              aria-selected=${active ? "true" : "false"}
              data-test-id="dashboard-history-item"
              @click=${() => selectHistoryVersion(props, viewState, entry.version)}
            >
              <span class="dashboard-history__version"
                >${t("dashboard.history.version", { version: String(entry.version) })}</span
              >
              <span class="dashboard-history__time">${formatRelativeTimestamp(entry.savedAt)}</span>
              ${
                entry.version === newestVersion
                  ? html`<span class="dashboard-history__latest"
                      >${t("dashboard.history.latest")}</span
                    >`
                  : nothing
              }
            </button>
          </li>
        `;
      })}
    </ul>
  `;
}

function renderHistoryDetail(
  props: BoardstateViewProps,
  state: DashboardUiState,
  viewState: DashboardViewState,
  version: number,
  snapshot: DashboardWorkspace | undefined,
): TemplateResult {
  const history = viewState.history;
  const current = state.workspace;
  const isNewest = version === (history.entries[0]?.version ?? null);
  if (!snapshot) {
    return html`<div class="card-sub" data-test-id="dashboard-history-loading">
      ${t("common.loading")}
    </div>`;
  }
  return html`
    <div class="dashboard-history__preview-wrap">
      <div class="dashboard-history__section-title">${t("dashboard.history.previewTitle")}</div>
      ${renderHistoryPreview(snapshot, state.activeSlug)}
    </div>
    <div class="dashboard-history__diff">
      <div class="dashboard-history__section-title">${t("dashboard.history.diffTitle")}</div>
      ${current ? renderHistoryDiff(snapshot, current) : nothing}
    </div>
    <div class="dashboard-history__restore">
      ${
        isNewest
          ? history.confirmRestore
            ? html`
                <span class="dashboard-history__confirm"
                  >${t("dashboard.history.restoreConfirm")}</span
                >
                <button
                  class="bs-btn bs-btn--small bs-btn--primary"
                  type="button"
                  ?disabled=${history.restoring}
                  data-test-id="dashboard-history-restore-confirm"
                  @click=${async () => {
                    history.restoring = true;
                    props.onRequestUpdate?.();
                    await undoWorkspace(state, props.transport);
                    history.restoring = false;
                    history.confirmRestore = false;
                    closeHistory(props, viewState);
                  }}
                >
                  ${t("dashboard.history.restore")}
                </button>
                <button
                  class="bs-btn bs-btn--small"
                  type="button"
                  @click=${() => {
                    history.confirmRestore = false;
                    props.onRequestUpdate?.();
                  }}
                >
                  ${t("common.cancel")}
                </button>
              `
            : html`<button
                class="bs-btn bs-btn--small"
                type="button"
                data-test-id="dashboard-history-restore"
                @click=${() => {
                  history.confirmRestore = true;
                  props.onRequestUpdate?.();
                }}
              >
                ${t("dashboard.history.restore")}
              </button>`
          : html`<span class="card-sub">${t("dashboard.history.restoreOnlyNewest")}</span>`
      }
    </div>
  `;
}

/**
 * Static read-only preview of a snapshot's active tab: reuses the grid placement
 * math but strips every interaction (no drag/resize handles, menus, or live
 * bindings) so a past state renders without any write affordance.
 */
function renderHistoryPreview(
  snapshot: DashboardWorkspace,
  activeSlug: string | null,
): TemplateResult {
  const tab =
    (activeSlug ? snapshot.tabs.find((entry) => entry.slug === activeSlug) : undefined) ??
    visibleTabs(snapshot)[0] ??
    snapshot.tabs[0];
  if (!tab || tab.widgets.length === 0) {
    return html`<div class="dashboard-history__preview dashboard-history__preview--empty">
      ${t("dashboard.history.previewEmpty")}
    </div>`;
  }
  const rows = gridRowCount(tab.widgets);
  const minHeight = rows * DASHBOARD_ROW_HEIGHT + Math.max(0, rows - 1) * DASHBOARD_GRID_GAP;
  return html`
    <div
      class="dashboard-history__preview dashboard-grid dashboard-grid--readonly"
      style="min-height: ${minHeight}px"
      data-test-id="dashboard-history-preview"
      aria-hidden="true"
    >
      ${tab.widgets.map((widget) => {
        const agent = dashboardAgentProvenance(widget.createdBy);
        return html`
          <div class="dashboard-history__cell" style=${gridPlacementStyle(widget.grid)}>
            <span class="dashboard-history__cell-title">${widget.title || widget.kind}</span>
            ${
              agent
                ? html`<span class="dashboard-widget__provenance"
                    >${t("dashboard.widget.provenanceChip")}</span
                  >`
                : nothing
            }
          </div>
        `;
      })}
    </div>
  `;
}

/** Compact changelist (added/removed/moved/retitled) grouped by author (m2). */
function renderHistoryDiff(
  snapshot: DashboardWorkspace,
  current: DashboardWorkspace,
): TemplateResult {
  const diff = computeWorkspaceDiff(snapshot, current);
  if (diff.length === 0) {
    return html`<div class="card-sub" data-test-id="dashboard-history-diff-empty">
      ${t("dashboard.history.diffEmpty")}
    </div>`;
  }
  const groups = groupDiffByActor(diff);
  return html`
    <div class="dashboard-history__diff-groups" data-test-id="dashboard-history-diff">
      ${groups.map(
        (group) => html`
          <div class="dashboard-history__diff-group">
            <div class="dashboard-history__diff-actor">
              ${group.actor ?? t("dashboard.history.actorUnknown")}
            </div>
            <ul class="dashboard-history__diff-list">
              ${group.entries.map(
                (entry) => html`
                  <li class="dashboard-history__diff-item">
                    <span class="dashboard-history__diff-kind"
                      >${t(`dashboard.history.kind.${entry.kind}`)}</span
                    >
                    <span class="dashboard-history__diff-label">${entry.label}</span>
                    ${
                      entry.detail
                        ? html`<span class="dashboard-history__diff-detail">${entry.detail}</span>`
                        : nothing
                    }
                  </li>
                `,
              )}
            </ul>
          </div>
        `,
      )}
    </div>
  `;
}

/**
 * Widget-gallery dialog (w3): browse an operator-entered registry index, then
 * install a bundle. SECURITY — the browse/fetch happens CLIENT-SIDE (the operator's
 * browser); the host only receives already-fetched bytes and writes a `pending`
 * widget behind the approval gate. The requested capabilities are surfaced BEFORE
 * the operator installs (and therefore before they approve).
 */
function renderGalleryDialog(
  props: BoardstateViewProps,
  state: DashboardUiState,
  viewState: DashboardViewState,
): TemplateResult | typeof nothing {
  const gallery = viewState.gallery;
  if (!gallery) {
    return nothing;
  }
  const requestUpdate = () => props.onRequestUpdate?.();
  const close = () => {
    viewState.gallery = null;
    requestUpdate();
  };
  const onUrlInput = (event: Event) => {
    gallery.indexUrl = (event.currentTarget as HTMLInputElement).value;
  };
  const browse = async () => {
    const url = gallery.indexUrl.trim();
    if (!url) {
      return;
    }
    gallery.busy = true;
    gallery.error = null;
    gallery.selected = null;
    requestUpdate();
    try {
      const entries = await fetchGalleryIndex(url);
      gallery.entries = entries;
      persistGalleryUrl(props.storage, url);
    } catch (err) {
      gallery.error = formatGalleryError(err);
    } finally {
      gallery.busy = false;
      requestUpdate();
    }
  };
  const preview = async (entry: GalleryEntry) => {
    gallery.busy = true;
    gallery.error = null;
    requestUpdate();
    try {
      gallery.selected = await fetchWidgetBundle(entry.manifestUrl);
    } catch (err) {
      gallery.error = formatGalleryError(err);
    } finally {
      gallery.busy = false;
      requestUpdate();
    }
  };
  const install = async () => {
    const bundle = gallery.selected;
    if (!bundle) {
      return;
    }
    gallery.busy = true;
    gallery.error = null;
    requestUpdate();
    try {
      // Client-fetched bytes → the host writes a `pending` registry entry (never
      // approved). Placing the widget on the active tab surfaces the existing
      // approval card, so the operator still approves before it mounts.
      await installGalleryWidget(props.transport, bundle);
      const activeTab = state.workspace ? findTab(state.workspace, state.activeSlug) : undefined;
      if (props.transport && activeTab) {
        await props.transport.request("dashboard.widget.add", {
          tab: activeTab.slug,
          widget: {
            kind: `custom:${bundle.name}`,
            title: bundle.title,
            grid: installPlacementGrid(activeTab, bundle),
          },
        });
      }
      await loadWorkspace(state, props.transport, { silent: true });
      viewState.gallery = null;
      requestUpdate();
    } catch (err) {
      gallery.error = formatGalleryError(err);
      gallery.busy = false;
      requestUpdate();
    }
  };
  return renderModal(
    t("dashboard.gallery.title"),
    close,
    html`
      <div class="dashboard-gallery" data-test-id="dashboard-gallery">
        <div class="dashboard-gallery__header">
          <div class="card-title">${t("dashboard.gallery.title")}</div>
          <div class="card-sub">${t("dashboard.gallery.subtitle")}</div>
        </div>
        <div class="dashboard-gallery__browse">
          <input
            class="bs-dialog__input"
            type="url"
            inputmode="url"
            data-test-id="dashboard-gallery-url"
            placeholder=${t("dashboard.gallery.urlPlaceholder")}
            aria-label=${t("dashboard.gallery.urlLabel")}
            .value=${gallery.indexUrl}
            @input=${onUrlInput}
          />
          <button
            class="bs-btn bs-btn--small bs-btn--primary"
            type="button"
            data-test-id="dashboard-gallery-browse"
            ?disabled=${gallery.busy}
            @click=${() => void browse()}
          >
            ${t("dashboard.gallery.browse")}
          </button>
        </div>
        ${
          gallery.error
            ? html`<div class="callout danger" role="alert" data-test-id="dashboard-gallery-error">
                ${gallery.error}
              </div>`
            : nothing
        }
        ${
          gallery.selected
            ? renderGalleryDetail(
                gallery.selected,
                () => {
                  gallery.selected = null;
                  requestUpdate();
                },
                () => void install(),
                gallery.busy,
              )
            : renderGalleryList(gallery, (entry) => void preview(entry))
        }
      </div>
    `,
  );
}

/** Browse results: one row per registry entry. */
function renderGalleryList(
  gallery: DashboardGalleryState,
  onSelect: (entry: GalleryEntry) => void,
): TemplateResult | typeof nothing {
  if (gallery.entries === null) {
    return nothing;
  }
  if (gallery.entries.length === 0) {
    return html`<div class="dashboard-gallery__empty">${t("dashboard.gallery.empty")}</div>`;
  }
  return html`
    <ul class="dashboard-gallery__list" data-test-id="dashboard-gallery-list">
      ${gallery.entries.map(
        (entry) => html`
          <li class="dashboard-gallery__item">
            <div class="dashboard-gallery__item-body">
              <div class="dashboard-gallery__item-name">${entry.name}</div>
              ${
                entry.description
                  ? html`<div class="dashboard-gallery__item-desc">${entry.description}</div>`
                  : nothing
              }
            </div>
            <button
              class="bs-btn bs-btn--small"
              type="button"
              data-test-id="dashboard-gallery-select"
              ?disabled=${gallery.busy}
              @click=${() => onSelect(entry)}
            >
              ${t("dashboard.gallery.view")}
            </button>
          </li>
        `,
      )}
    </ul>
  `;
}

/** Selected-bundle detail: surfaces the REQUESTED CAPABILITIES before installing. */
function renderGalleryDetail(
  bundle: GalleryBundle,
  onBack: () => void,
  onInstall: () => void,
  busy: boolean,
): TemplateResult {
  return html`
    <div class="dashboard-gallery__detail" data-test-id="dashboard-gallery-detail">
      <div class="dashboard-gallery__item-name">${bundle.title}</div>
      <div class="dashboard-gallery__caps">
        <div class="dashboard-gallery__caps-label">${t("dashboard.gallery.capabilities")}</div>
        ${
          bundle.capabilities.length === 0
            ? html`<span class="dashboard-gallery__cap"
                >${t("dashboard.gallery.noCapabilities")}</span
              >`
            : bundle.capabilities.map(
                (cap) =>
                  html`<span class="dashboard-gallery__cap" data-test-id="dashboard-gallery-cap"
                    >${cap}</span
                  >`,
              )
        }
      </div>
      <div class="dashboard-gallery__pending-note">${t("dashboard.gallery.pendingNote")}</div>
      <div class="bs-dialog__actions">
        <button
          class="bs-btn bs-btn--primary"
          type="button"
          data-test-id="dashboard-gallery-install"
          ?disabled=${busy}
          @click=${onInstall}
        >
          ${t("dashboard.gallery.install")}
        </button>
        <button class="bs-btn" type="button" @click=${onBack}>${t("common.back")}</button>
      </div>
    </div>
  `;
}

/**
 * `<boardstate-view>` — the reference view custom element. Renders into light DOM
 * (so injected theme tokens / CSS cascade). Set `transport` + `connected` to drive
 * it; `strings`/`onNavigate`/`storage`/`confirm`/`embed`/`basePath`/`initialTab`
 * customize behavior.
 */
export class BoardstateViewElement extends LitElement {
  override createRenderRoot(): HTMLElement {
    return this;
  }

  transport: Transport | null = null;
  connected = false;
  strings?: BoardstateStrings;
  onNavigate?: (slug: string) => void;
  storage?: BoardstateStorage;
  confirm?: (text: string) => Promise<boolean> | boolean;
  embed?: BoardstateEmbedPolicy;
  basePath?: string;
  initialTab?: string | null;
  sessionKey?: string;
  logbookHref?: string | null;

  static override properties = {
    transport: { attribute: false },
    connected: { type: Boolean },
    strings: { attribute: false },
    onNavigate: { attribute: false },
    storage: { attribute: false },
    confirm: { attribute: false },
    embed: { attribute: false },
    basePath: { type: String },
    initialTab: { type: String },
    sessionKey: { type: String },
    logbookHref: { type: String },
  };

  override render(): unknown {
    return renderBoardstateView({
      host: this,
      transport: this.transport,
      connected: this.connected,
      onRequestUpdate: () => this.requestUpdate(),
      ...(this.strings ? { strings: this.strings } : {}),
      ...(this.onNavigate ? { onNavigate: this.onNavigate } : {}),
      ...(this.storage ? { storage: this.storage } : {}),
      ...(this.confirm ? { confirm: this.confirm } : {}),
      ...(this.embed ? { embed: this.embed } : {}),
      ...(this.basePath !== undefined ? { basePath: this.basePath } : {}),
      ...(this.initialTab !== undefined ? { initialTab: this.initialTab } : {}),
      ...(this.sessionKey !== undefined ? { sessionKey: this.sessionKey } : {}),
      ...(this.logbookHref !== undefined ? { logbookHref: this.logbookHref } : {}),
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    stopDashboard(this);
    stopBoardstateView(this);
  }
}

if (typeof customElements !== "undefined" && !customElements.get("boardstate-view")) {
  customElements.define("boardstate-view", BoardstateViewElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "boardstate-view": BoardstateViewElement;
  }
}

// Re-exported for tests that render the view into a detached container.
export { render };
