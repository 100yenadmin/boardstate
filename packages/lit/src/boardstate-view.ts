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
  collides,
  customWidgetName,
  customWidgetStatus,
  findTab,
  gridPlacementStyle,
  gridRowCount,
  hiddenTabs,
  nudgeRect,
  orderedTabs,
  resolveActiveSlug,
  resolveDrop,
  updateDrag,
  visibleTabs,
  type DashboardBinding,
  type DashboardDragState,
  type DashboardTab,
  type DashboardWidget,
  type DashboardWorkspace,
  type Transport,
  type WidgetManifestView,
} from "@boardstate/core";
import {
  approveWidget,
  clearActiveDrag,
  getDashboardState,
  hideWidget,
  loadWidgetManifestView,
  loadWorkspace,
  moveWidget,
  moveWidgetToTab,
  registerActiveDrag,
  removeWidgetFromTab,
  resolveBinding,
  setWidgetCollapsed,
  startBindingPolling,
  stopDashboard,
  subscribeToDashboardEvents,
  updateWidgetTitle,
  type DashboardBindingResult,
  type DashboardUiState,
} from "@boardstate/host";
import {
  renderWidgetCell,
  type DashboardCustomWidgetContext,
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
  manifestCache: Map<string, WidgetManifestView>;
  manifestLoads: Set<string>;
  dataVersion: number;
  dialog: DashboardDialogState | null;
  onboardingDismissed: boolean;
};

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

/** View-level teardown: drop any menu-dismiss listeners. */
export function stopBoardstateView(host: object): void {
  teardownMenuDismiss(host);
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
      manifestCache: new Map(),
      manifestLoads: new Set(),
      dataVersion: 0,
      dialog: null,
      onboardingDismissed: isOnboardingDismissed(storage),
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
  for (const widget of tab.widgets) {
    const binding = primaryBinding(widget);
    if (
      !binding ||
      viewState.bindingResults.has(widget.id) ||
      viewState.bindingLoads.has(widget.id)
    ) {
      continue;
    }
    viewState.bindingLoads.add(widget.id);
    void resolveBinding(transport, binding).then((result) => {
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

/** First-visit onboarding banner teaching how to add a tab. Dismissible + persisted. */
function renderOnboardingBanner(
  props: BoardstateViewProps,
  viewState: DashboardViewState,
  requestUpdate: () => void,
): TemplateResult | typeof nothing {
  if (viewState.onboardingDismissed) {
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

function renderTabStrip(
  props: BoardstateViewProps,
  state: DashboardUiState,
  workspace: DashboardWorkspace,
): TemplateResult {
  const tabs = visibleTabs(workspace);
  const hidden = hiddenTabs(workspace);
  return html`
    <nav class="dashboard-tabs" role="tablist" aria-label=${t("dashboard.tabs.label")}>
      ${tabs.map((tab) => {
        const active = tab.slug === state.activeSlug;
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
          </button>
        `;
      })}
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

/** Builds the custom-widget context for one `custom:<name>` widget, or null. */
function buildCustomContext(
  props: BoardstateViewProps,
  state: DashboardUiState,
  viewState: DashboardViewState,
  workspace: DashboardWorkspace,
  widget: DashboardWidget,
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
      ...(props.confirm ? { confirmPrompt: props.confirm } : {}),
    },
    onApprove: () => void approveWidget(state, props.transport, { name, decision: "approved" }),
    onReject: () => void approveWidget(state, props.transport, { name, decision: "rejected" }),
  };
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
  const callbacks = makeCallbacks(props, state, viewState, tab);
  const builtinContext: BuiltinWidgetContext = { embed: embedContext(props.embed) };
  const rows = gridRowCount(tab.widgets);
  const minHeight = rows * DASHBOARD_ROW_HEIGHT + Math.max(0, rows - 1) * DASHBOARD_GRID_GAP;
  return html`
    <div class="dashboard-grid" style="min-height: ${minHeight}px" data-test-id="dashboard-grid">
      ${tab.widgets.map((widget) => {
        const custom = buildCustomContext(props, state, viewState, workspace, widget);
        return renderWidgetCell({
          widget,
          binding: viewState.bindingResults.get(widget.id) ?? null,
          menuOpen: viewState.openMenuWidgetId === widget.id,
          pending: state.pendingWidgetIds.has(widget.id),
          dragging: viewState.drag?.widgetId === widget.id,
          builtinContext,
          callbacks,
          ...(custom ? { custom } : {}),
        });
      })}
      ${renderDragGhost(viewState, tab)}
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
    if (target.setPointerCapture) {
      target.setPointerCapture(event.pointerId);
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
    props.onRequestUpdate?.();
  });
  if (active && !state.loaded && !state.loading && !state.error) {
    void loadWorkspace(state, props.transport, { requestedSlug: props.initialTab ?? null });
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
    ${renderWorkspacesHeader(tab)}
    ${renderOnboardingBanner(props, viewState, () => props.onRequestUpdate?.())}
    ${renderTabStrip(props, state, workspace)}
    ${renderGrid(props, state, viewState, workspace, tab)}
  `;
}

/** Page-header treatment for the active workspace tab. */
function renderWorkspacesHeader(tab: DashboardTab): TemplateResult {
  return html`
    <div class="dashboard-page-header" data-test-id="dashboard-page-header">
      <div class="page-title">${tab.title}</div>
      <div class="page-sub">${t("dashboard.header.subtitle")}</div>
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
