// Cell chrome for a dashboard widget: title bar, collapse toggle, kebab menu,
// provenance badge, and a per-cell error boundary. Pure render fns — the view owns
// state and passes callbacks in.
//
// The error boundary wraps the widget body render: a throw yields an error card in
// this cell only, so the shell and sibling widgets are unaffected.

import { html, nothing, type TemplateResult } from "lit";
import {
  dashboardAgentProvenance,
  gridPlacementStyle,
  type DashboardWidget,
  type DashboardWidgetStatus,
  type WidgetManifestView,
} from "@boardstate/core";
import type { DashboardBindingResult } from "@boardstate/host";
import {
  renderCustomWidgetHost,
  type CustomWidgetHostContext,
} from "./boardstate-custom-widget.js";
import { icons } from "./icons.js";
import { getBuiltinRenderer, type BuiltinWidgetContext } from "./renderers/index.js";
import { t } from "./strings.js";

export type DashboardWidgetCellCallbacks = {
  onToggleCollapse: (widget: DashboardWidget) => void;
  onToggleMenu: (widget: DashboardWidget) => void;
  onHide: (widget: DashboardWidget) => void;
  onRemove: (widget: DashboardWidget) => void;
  onEditTitle: (widget: DashboardWidget) => void;
  onMoveToTab: (widget: DashboardWidget) => void;
  /** Pin a temporary (ephemeral) widget so the TTL sweep keeps it. */
  onPin: (widget: DashboardWidget) => void;
  onMovePointerDown: (widget: DashboardWidget, event: PointerEvent) => void;
  onResizePointerDown: (widget: DashboardWidget, event: PointerEvent) => void;
  onKeyboardNudge: (
    widget: DashboardWidget,
    mode: "move" | "resize",
    direction: "left" | "right" | "up" | "down",
  ) => void;
};

/**
 * Custom-widget (`custom:<name>`) rendering context. Passed only for custom
 * widgets; builtin widgets ignore it. Carries the registry approval status (gates
 * whether an iframe is ever built), the loaded manifest, the sandbox host context,
 * and the operator-only approve/reject actions for the pending placeholder.
 */
export type DashboardCustomWidgetContext = {
  status: DashboardWidgetStatus | null;
  manifest: WidgetManifestView | null;
  host: CustomWidgetHostContext;
  onApprove: (widget: DashboardWidget) => void;
  onReject: (widget: DashboardWidget) => void;
};

/**
 * Blame metadata for the cell menu (M2): who authored the widget, the version it
 * first appeared (when recoverable from loaded history), and a logbook deep link
 * when the author is an agent and the link is derivable. `agentId` is non-null iff
 * the author is `agent:<id>`.
 */
export type DashboardWidgetBlame = {
  actor: string;
  agentId: string | null;
  firstSeenVersion?: number;
  logbookHref?: string | null;
};

export type DashboardWidgetCellProps = {
  widget: DashboardWidget;
  /** Resolved binding value for the primary binding, or an error to surface. */
  binding: DashboardBindingResult | null;
  /** Provenance/blame line for the menu; present when the widget carries a `createdBy`. */
  blame?: DashboardWidgetBlame;
  menuOpen: boolean;
  pending: boolean;
  /** When set, this cell is the live drag/resize ghost source. */
  dragging: boolean;
  /** Ambient context builtins may need (embed policy for iframe-embed). */
  builtinContext: BuiltinWidgetContext;
  callbacks: DashboardWidgetCellCallbacks;
  /** Present for `custom:` widgets only; builtin widgets leave this undefined. */
  custom?: DashboardCustomWidgetContext;
};

/**
 * Visible widget title with a trailing " (custom)" provenance suffix stripped: the
 * suffix is redundant with the AI/provenance chip and only causes truncation; the
 * full title is still exposed via the `title=` attribute.
 */
export function displayWidgetTitle(title: string): string {
  return title.replace(/\s*\(custom\)\s*$/iu, "").trim() || title;
}

/** Renders the provenance chip when a widget was authored by an agent. */
function renderProvenanceChip(widget: DashboardWidget): TemplateResult | typeof nothing {
  const agentId = dashboardAgentProvenance(widget.createdBy);
  if (!agentId) {
    return nothing;
  }
  return html`<span
    class="dashboard-widget__provenance"
    title=${t("dashboard.widget.provenanceTooltip", { agent: agentId })}
    >${t("dashboard.widget.provenanceChip")}</span
  >`;
}

/** Subtle badge marking a temporary (ephemeral) Living Answer; pinning clears it. */
function renderEphemeralBadge(widget: DashboardWidget): TemplateResult | typeof nothing {
  if (!widget.ephemeral) {
    return nothing;
  }
  return html`<span
    class="dashboard-widget__ephemeral"
    data-test-id="dashboard-widget-ephemeral"
    title=${t("dashboard.widget.ephemeralTooltip")}
    >${t("dashboard.widget.ephemeralBadge")}</span
  >`;
}

/**
 * Blame line shown at the top of the cell menu (M2): "Created by {actor} · v{n}",
 * with a logbook deep link when the author is an agent and the link is derivable.
 * When the logbook seam yields no link, the provenance line renders on its own.
 */
function renderBlame(blame: DashboardWidgetBlame): TemplateResult {
  const label =
    blame.firstSeenVersion !== undefined
      ? t("dashboard.widget.blame.createdByVersion", {
          actor: blame.actor,
          version: String(blame.firstSeenVersion),
        })
      : t("dashboard.widget.blame.createdBy", { actor: blame.actor });
  const showLink = blame.agentId !== null && Boolean(blame.logbookHref);
  return html`
    <div class="dashboard-widget__blame" role="note" data-test-id="dashboard-widget-blame">
      <span class="dashboard-widget__blame-text">${label}</span>
      ${
        showLink
          ? html`<a
              class="dashboard-widget__blame-link"
              href=${blame.logbookHref!}
              target="_blank"
              rel="noopener noreferrer"
              data-test-id="dashboard-widget-blame-link"
              >${icons.externalLink} ${t("dashboard.widget.blame.logbookLink")}</a
            >`
          : nothing
      }
    </div>
  `;
}

function renderMenu(
  widget: DashboardWidget,
  callbacks: DashboardWidgetCellCallbacks,
  blame: DashboardWidgetBlame | undefined,
): TemplateResult {
  return html`
    <div class="dashboard-widget__menu" role="menu">
      ${blame ? renderBlame(blame) : nothing}
      ${
        widget.ephemeral
          ? html`<button
              class="dashboard-widget__menu-item"
              type="button"
              role="menuitem"
              data-test-id="dashboard-widget-pin"
              @click=${() => callbacks.onPin(widget)}
            >
              ${t("dashboard.widget.menu.pin")}
            </button>`
          : nothing
      }
      <button
        class="dashboard-widget__menu-item"
        type="button"
        role="menuitem"
        @click=${() => callbacks.onEditTitle(widget)}
      >
        ${t("dashboard.widget.menu.editTitle")}
      </button>
      <button
        class="dashboard-widget__menu-item"
        type="button"
        role="menuitem"
        @click=${() => callbacks.onMoveToTab(widget)}
      >
        ${t("dashboard.widget.menu.moveToTab")}
      </button>
      <button
        class="dashboard-widget__menu-item"
        type="button"
        role="menuitem"
        @click=${() => callbacks.onHide(widget)}
      >
        ${t("dashboard.widget.menu.hide")}
      </button>
      <button
        class="dashboard-widget__menu-item dashboard-widget__menu-item--danger"
        type="button"
        role="menuitem"
        @click=${() => callbacks.onRemove(widget)}
      >
        ${t("dashboard.widget.menu.remove")}
      </button>
    </div>
  `;
}

/**
 * Renders a builtin widget body via the renderer registry. A binding error is
 * re-thrown so the cell error boundary shows it inline; unknown/custom kinds render
 * a placeholder (custom widgets are dispatched by renderWidgetBody first).
 */
export function renderBuiltinWidget(
  widget: DashboardWidget,
  binding: DashboardBindingResult | null,
  ctx: BuiltinWidgetContext,
): TemplateResult {
  if (binding && "error" in binding) {
    // A binding failure is data-level, not a render throw: show it inline so the
    // widget stays mounted and refetches on the next broadcast.
    throw new Error(binding.error);
  }
  const value = binding && "value" in binding ? binding.value : undefined;
  const renderer = getBuiltinRenderer(widget.kind);
  if (renderer) {
    return renderer(widget, value, ctx);
  }
  if (widget.kind.startsWith("custom:")) {
    return html`<div class="dashboard-widget__placeholder">
      ${t("dashboard.widget.customPlaceholder")}
    </div>`;
  }
  return html`<div class="dashboard-widget__placeholder">
    ${t("dashboard.widget.unknownKind", { kind: widget.kind })}
  </div>`;
}

/**
 * Renders a `custom:<name>` widget. The registry status is the render gate,
 * mirroring the server's approved-only serving gate:
 * - `approved` → the sandboxed iframe host (only path that ever builds an iframe).
 * - `pending`  → a placeholder card with operator-only Approve/Reject.
 * - `rejected` / unknown → a neutral placeholder; NO iframe is constructed.
 */
export function renderCustomWidget(
  widget: DashboardWidget,
  custom: DashboardCustomWidgetContext,
): TemplateResult {
  if (custom.status === "approved") {
    if (!custom.manifest) {
      return html`<div
        class="dashboard-widget__placeholder"
        data-test-id="dashboard-custom-loading"
      >
        ${t("dashboard.widget.customLoading")}
      </div>`;
    }
    return renderCustomWidgetHost({
      widget,
      manifest: custom.manifest,
      context: custom.host,
    });
  }
  if (custom.status === "pending") {
    const author = dashboardAgentProvenance(widget.createdBy);
    return html`
      <div
        class="dashboard-widget__approval"
        role="group"
        data-test-id="dashboard-custom-pending"
        aria-label=${t("dashboard.widget.approval.title")}
      >
        <div class="dashboard-widget__approval-title">${t("dashboard.widget.approval.title")}</div>
        <div class="dashboard-widget__approval-sub">
          ${
            author
              ? t("dashboard.widget.approval.byAgent", { agent: author })
              : t("dashboard.widget.approval.byUnknown")
          }
        </div>
        <div class="dashboard-widget__approval-actions">
          <button
            class="bs-btn bs-btn--small bs-btn--primary"
            type="button"
            data-test-id="dashboard-custom-approve"
            @click=${() => custom.onApprove(widget)}
          >
            ${t("dashboard.widget.approval.approve")}
          </button>
          <button
            class="bs-btn bs-btn--small"
            type="button"
            data-test-id="dashboard-custom-reject"
            @click=${() => custom.onReject(widget)}
          >
            ${t("dashboard.widget.approval.reject")}
          </button>
        </div>
      </div>
    `;
  }
  return html`<div class="dashboard-widget__placeholder" data-test-id="dashboard-custom-rejected">
    ${t("dashboard.widget.approval.unavailable")}
  </div>`;
}

/**
 * Error boundary around the widget body. Any throw during the builtin render (a
 * broken widget, a bad binding) is caught and rendered as an error card in THIS
 * cell — siblings and the shell keep rendering.
 */
export function renderWidgetBody(
  widget: DashboardWidget,
  binding: DashboardBindingResult | null,
  ctx: BuiltinWidgetContext,
  callbacks: DashboardWidgetCellCallbacks,
  custom?: DashboardCustomWidgetContext,
): TemplateResult {
  try {
    if (widget.kind.startsWith("custom:") && custom) {
      return renderCustomWidget(widget, custom);
    }
    return renderBuiltinWidget(widget, binding, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return html`
      <div class="dashboard-widget__error" role="alert" data-test-id="dashboard-widget-error">
        <div class="dashboard-widget__error-title">${t("dashboard.widget.errorTitle")}</div>
        <div class="dashboard-widget__error-humane">${t("dashboard.widget.errorHumane")}</div>
        <details class="dashboard-widget__error-detail">
          <summary>${t("dashboard.widget.errorDetailSummary")}</summary>
          <div class="dashboard-widget__error-message">${message}</div>
        </details>
        <button
          class="bs-btn bs-btn--small"
          type="button"
          @click=${() => callbacks.onRemove(widget)}
        >
          ${t("dashboard.widget.menu.remove")}
        </button>
      </div>
    `;
  }
}

export function renderWidgetCell(props: DashboardWidgetCellProps): TemplateResult {
  const { widget, callbacks } = props;
  const classes = [
    "dashboard-widget",
    widget.collapsed ? "dashboard-widget--collapsed" : "",
    props.pending ? "dashboard-widget--pending" : "",
    props.dragging ? "dashboard-widget--dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return html`
    <section
      class=${classes}
      style=${gridPlacementStyle(widget.grid)}
      data-widget-id=${widget.id}
      data-test-id="dashboard-widget"
    >
      <header
        class="dashboard-widget__bar"
        @pointerdown=${(event: PointerEvent) => callbacks.onMovePointerDown(widget, event)}
      >
        <button
          class="dashboard-widget__collapse"
          type="button"
          aria-expanded=${widget.collapsed ? "false" : "true"}
          aria-label=${
            widget.collapsed ? t("dashboard.widget.expand") : t("dashboard.widget.collapse")
          }
          @pointerdown=${(event: PointerEvent) => event.stopPropagation()}
          @click=${() => callbacks.onToggleCollapse(widget)}
        >
          ${widget.collapsed ? icons.chevronRight : icons.chevronDown}
        </button>
        <span class="dashboard-widget__title" title=${widget.title}
          >${displayWidgetTitle(widget.title)}</span
        >
        ${renderProvenanceChip(widget)} ${renderEphemeralBadge(widget)}
        <span
          class="dashboard-widget__handle"
          role="button"
          tabindex="0"
          aria-label=${t("dashboard.widget.moveHandle")}
          @keydown=${(event: KeyboardEvent) => handleNudgeKey(event, widget, "move", callbacks)}
          >${icons.arrowUpDown}</span
        >
        <button
          class="dashboard-widget__menu-toggle"
          type="button"
          aria-haspopup="menu"
          aria-expanded=${props.menuOpen ? "true" : "false"}
          aria-label=${t("dashboard.widget.menuLabel")}
          @pointerdown=${(event: PointerEvent) => event.stopPropagation()}
          @click=${() => callbacks.onToggleMenu(widget)}
        >
          ${icons.moreHorizontal}
        </button>
        ${props.menuOpen ? renderMenu(widget, callbacks, props.blame) : nothing}
      </header>
      ${
        widget.collapsed
          ? nothing
          : html`
              <div class="dashboard-widget__body">
                ${renderWidgetBody(
                  widget,
                  props.binding,
                  props.builtinContext,
                  callbacks,
                  props.custom,
                )}
              </div>
              <span
                class="dashboard-widget__resize"
                role="button"
                tabindex="0"
                aria-label=${t("dashboard.widget.resizeHandle")}
                @pointerdown=${(event: PointerEvent) => callbacks.onResizePointerDown(widget, event)}
                @keydown=${(event: KeyboardEvent) =>
                  handleNudgeKey(event, widget, "resize", callbacks)}
              ></span>
            `
      }
    </section>
  `;
}

/** Keyboard fallback for move/resize (a11y): arrow keys nudge by one grid unit. */
function handleNudgeKey(
  event: KeyboardEvent,
  widget: DashboardWidget,
  mode: "move" | "resize",
  callbacks: DashboardWidgetCellCallbacks,
): void {
  const direction =
    event.key === "ArrowLeft"
      ? "left"
      : event.key === "ArrowRight"
        ? "right"
        : event.key === "ArrowUp"
          ? "up"
          : event.key === "ArrowDown"
            ? "down"
            : null;
  if (!direction) {
    return;
  }
  event.preventDefault();
  callbacks.onKeyboardNudge(widget, mode, direction);
}
