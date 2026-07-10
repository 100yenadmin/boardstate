// builtin:action-button — one click → invoke a granted external tool with fixed args
// (SPEC §17 v2 / §18). The full invocation lifecycle renders INLINE: idle → running →
// (readOnly) result | (mutation) pending "waiting for operator" → confirmed/denied/expired.
//
// SECURITY MODEL (normative):
//  • The tool RESULT is untrusted external DATA — rendered INERT (a plain text binding
//    that lit escapes; never `unsafeHTML`), so it can never inject markup or re-drive
//    the board (epic invariant #1).
//  • A mutation is NEVER auto-executed: `dashboard.action.invoke` PARKS it as a pending
//    action and only an OPERATOR confirm runs it (invariant #5, server-enforced). Over a
//    networked transport the confirm affordance is absent (`ctx.actions.confirm`
//    undefined) and this widget renders it disabled-with-reason.
//  • The AND-gate is the engine's: a tool granted at validation may be revoked before
//    invoke — the engine re-checks and rejects, surfaced here as an inline error.
//
// Like `chat`, this is a long-lived interactive island (it owns invocation state + a
// live `dashboard.action.changed` subscription), so it follows the `notes`/`chat`
// pattern: a per-widget `ActionButtonController` mounted via a `ref` callback that
// re-renders its own subtree, absorbing a fresh `ctx` on every parent re-render.

import { html, nothing, render, type TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";
import { mapActionButton, type DashboardWidget } from "@boardstate/core";
import { t } from "../strings.js";
import type { ActionChange, BuiltinWidgetContext } from "./types.js";

/** The inline lifecycle state of one action button. */
type ActionPhase =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "result"; value: unknown }
  | { kind: "pending"; id: string; expiresAt: string }
  | { kind: "confirmed" }
  | { kind: "denied" }
  | { kind: "expired" }
  | { kind: "error"; message: string };

/** Stringify a tool result for INERT display (never markup). Objects pretty-print as JSON. */
function formatResult(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * The per-widget interactive island. One instance per widget id (keyed in the module
 * map below); it holds the invocation phase + the live action subscription and
 * re-renders its own subtree with lit's `render()`.
 */
class ActionButtonController {
  private root: HTMLElement | null = null;
  private ctx: BuiltinWidgetContext | null = null;
  private widget: DashboardWidget | null = null;
  private phase: ActionPhase = { kind: "idle" };
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly widgetId: string) {}

  /** `ref` callback for the container: mount on connect, tear down on removal. */
  readonly rootRef = (element: Element | undefined): void => {
    if (element instanceof HTMLElement) {
      this.mount(element);
    } else {
      this.destroy();
    }
  };

  /** Absorb the latest render context/widget (parent re-render) and refresh the island. */
  setContext(ctx: BuiltinWidgetContext, widget: DashboardWidget): void {
    this.ctx = ctx;
    this.widget = widget;
    if (this.root) {
      this.renderIsland();
    }
  }

  private mount(element: HTMLElement): void {
    this.root = element;
    // A fresh element means a fresh mount: reset any prior subscription/state.
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.phase = { kind: "idle" };
    this.renderIsland();
    const actions = this.ctx?.actions;
    if (actions) {
      this.unsubscribe = actions.subscribe((change) => this.onActionChange(change));
    }
  }

  private destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.root = null;
    controllers.delete(this.widgetId);
  }

  /** React to a pending-action lifecycle change that concerns THIS button's parked action. */
  private onActionChange(change: ActionChange): void {
    if (this.phase.kind !== "pending" || change.id !== this.phase.id) {
      return;
    }
    if (change.status === "confirmed") {
      this.phase = { kind: "confirmed" };
    } else if (change.status === "denied") {
      this.phase = { kind: "denied" };
    } else if (change.status === "expired") {
      this.phase = { kind: "expired" };
    } else {
      return;
    }
    this.renderIsland();
  }

  private setPhase(phase: ActionPhase): void {
    this.phase = phase;
    this.renderIsland();
  }

  private onInvoke = (): void => {
    const actions = this.ctx?.actions;
    if (!actions || !this.widget) {
      return;
    }
    const model = mapActionButton(this.widget);
    if (!model.connector || !model.tool) {
      this.setPhase({ kind: "error", message: t("dashboard.widget.actionButton.misconfigured") });
      return;
    }
    this.setPhase({ kind: "running" });
    void actions
      .invoke({
        connector: model.connector,
        tool: model.tool,
        ...(model.args ? { args: model.args } : {}),
      })
      .then((outcome) => {
        this.setPhase(
          outcome.kind === "pending"
            ? { kind: "pending", id: outcome.id, expiresAt: outcome.expiresAt }
            : { kind: "result", value: outcome.result },
        );
      })
      .catch((err: unknown) => {
        this.setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
  };

  private onConfirm = (id: string): void => {
    const confirm = this.ctx?.actions?.confirm;
    if (!confirm) {
      return;
    }
    this.setPhase({ kind: "running" });
    void confirm(id)
      .then(({ result }) => this.setPhase({ kind: "result", value: result }))
      .catch((err: unknown) => {
        this.setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
  };

  private onDeny = (id: string): void => {
    const deny = this.ctx?.actions?.deny;
    if (!deny) {
      return;
    }
    void deny(id)
      .then(() => this.setPhase({ kind: "denied" }))
      .catch((err: unknown) => {
        this.setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
  };

  private renderIsland(): void {
    if (!this.root) {
      return;
    }
    render(this.template(), this.root);
  }

  private template(): TemplateResult {
    const actions = this.ctx?.actions;
    const model = this.widget ? mapActionButton(this.widget) : null;
    const label = model?.label ?? t("dashboard.widget.actionButton.run");
    const busy = this.phase.kind === "running" || this.phase.kind === "pending";
    return html`
      <div class="dashboard-action-button" data-test-id="dashboard-action-button">
        <button
          class="bs-btn bs-btn--small bs-btn--primary dashboard-action-button__invoke"
          type="button"
          data-test-id="dashboard-action-button-invoke"
          ?disabled=${!actions || busy}
          @click=${this.onInvoke}
        >
          ${label}
        </button>
        ${
          !actions
            ? html`<div
                class="dashboard-action-button__hint"
                data-test-id="dashboard-action-button-disconnected"
              >
                ${t("dashboard.widget.actionButton.disconnected")}
              </div>`
            : this.renderStatus()
        }
      </div>
    `;
  }

  private renderStatus(): TemplateResult | typeof nothing {
    switch (this.phase.kind) {
      case "idle":
        return nothing;
      case "running":
        return html`<div class="dashboard-action-button__status" data-status="running">
          ${t("dashboard.widget.actionButton.invoking")}
        </div>`;
      case "pending":
        return this.renderPending(this.phase.id);
      case "confirmed":
        return html`<div
          class="dashboard-action-button__status"
          data-status="confirmed"
          data-test-id="dashboard-action-button-confirmed"
        >
          ${t("dashboard.widget.actionButton.confirmed")}
        </div>`;
      case "denied":
        return html`<div
          class="dashboard-action-button__status"
          data-status="denied"
          data-test-id="dashboard-action-button-denied"
        >
          ${t("dashboard.widget.actionButton.denied")}
        </div>`;
      case "expired":
        return html`<div
          class="dashboard-action-button__status"
          data-status="expired"
          data-test-id="dashboard-action-button-expired"
        >
          ${t("dashboard.widget.actionButton.expired")}
        </div>`;
      case "result":
        // INERT: a text binding lit escapes — the untrusted tool result can never
        // inject markup or re-drive the board (epic invariant #1).
        return html`<div class="dashboard-action-button__result" data-status="result">
          <div class="dashboard-action-button__result-label">
            ${t("dashboard.widget.actionButton.resultLabel")}
          </div>
          <pre
            class="dashboard-action-button__result-body"
            data-test-id="dashboard-action-button-result"
          >
${formatResult(this.phase.value)}</pre>
        </div>`;
      case "error":
        return html`<div
          class="dashboard-action-button__error"
          role="alert"
          data-test-id="dashboard-action-button-error"
        >
          <span class="dashboard-action-button__result-label"
            >${t("dashboard.widget.actionButton.errorLabel")}</span
          >
          <span class="dashboard-action-button__error-message">${this.phase.message}</span>
        </div>`;
    }
  }

  /** The parked-mutation row: "waiting for operator" + confirm/deny (operator only). */
  private renderPending(id: string): TemplateResult {
    const canConfirm = Boolean(this.ctx?.actions?.confirm && this.ctx?.actions?.deny);
    return html`
      <div
        class="dashboard-action-button__pending"
        data-status="pending"
        data-test-id="dashboard-action-button-pending"
      >
        <span class="dashboard-action-button__status-text"
          >${t("dashboard.widget.actionButton.pending")}</span
        >
        ${
          canConfirm
            ? html`<span class="dashboard-action-button__pending-actions">
                <button
                  class="bs-btn bs-btn--small bs-btn--primary"
                  type="button"
                  data-test-id="dashboard-action-button-confirm"
                  @click=${() => this.onConfirm(id)}
                >
                  ${t("dashboard.widget.actionButton.confirm")}
                </button>
                <button
                  class="bs-btn bs-btn--small"
                  type="button"
                  data-test-id="dashboard-action-button-deny"
                  @click=${() => this.onDeny(id)}
                >
                  ${t("dashboard.widget.actionButton.deny")}
                </button>
              </span>`
            : html`<span
                class="dashboard-action-button__operator-only"
                data-test-id="dashboard-action-button-operator-only"
                >${t("dashboard.widget.actionButton.operatorOnly")}</span
              >`
        }
      </div>
    `;
  }
}

/** One live controller per widget id. Created lazily; removed on the widget's unmount. */
const controllers = new Map<string, ActionButtonController>();

/**
 * Renders builtin:action-button. The renderer stays a pure function returning the
 * island's container; the `ActionButtonController` (keyed by widget id) owns the
 * invocation lifecycle and its own render loop, hydrated via the `ref` callback.
 */
export function renderActionButton(
  widget: DashboardWidget,
  _value: unknown,
  ctx: BuiltinWidgetContext,
): TemplateResult {
  let controller = controllers.get(widget.id);
  if (!controller) {
    controller = new ActionButtonController(widget.id);
    controllers.set(widget.id, controller);
  }
  controller.setContext(ctx, widget);
  return html`<div class="dashboard-action-button-host" ${ref(controller.rootRef)}></div>`;
}
