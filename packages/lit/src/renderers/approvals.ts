// builtin:approvals — a pending-approval queue with per-row Approve/Deny actions.
//
// The pending list + resolver arrive via `ctx.approvals` (mirroring iframe-embed's
// `ctx.embed`), not the primary binding `value`, because the queue is in-memory
// workspace state rather than an allowlisted RPC read. The view wires `onDecide`
// through the same client path the custom-widget pending card uses. The
// `mapApprovals` / `buildWidgetApprovalsSource` transforms live in
// `@boardstate/core`.

import { html, nothing, type TemplateResult } from "lit";
import { mapApprovals, type DashboardWidget } from "@boardstate/core";
import { t } from "../strings.js";
import type { BuiltinWidgetContext } from "./types.js";

/** The badge label for an approval row's kind (widget / data source / action). */
function kindLabel(kind: "widget" | "capability" | "action"): string {
  if (kind === "capability") {
    return t("dashboard.widget.approvals.kind.capability");
  }
  if (kind === "action") {
    return t("dashboard.widget.approvals.kind.action");
  }
  return t("dashboard.widget.approvals.kind.widget");
}

/**
 * Collect the ticked tool ids for a capability row: read the checkboxes inside THIS
 * row (uncontrolled — their DOM state persists across re-renders until the row's data
 * changes). All ticked ⇒ the operator approves the full requested set.
 */
function checkedTools(event: Event): string[] {
  const row = (event.currentTarget as HTMLElement | null)?.closest("li");
  if (!row) {
    return [];
  }
  return [...row.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    .filter((box) => box.checked)
    .map((box) => box.value);
}

export function renderApprovals(
  widget: DashboardWidget,
  _value: unknown,
  ctx: BuiltinWidgetContext,
): TemplateResult {
  const source = ctx.approvals;
  const model = mapApprovals(widget, source);
  if (model.items.length === 0) {
    return html`<div class="dashboard-widget__placeholder">
      ${t("dashboard.widget.approvals.empty")}
    </div>`;
  }
  return html`
    <ul class="dashboard-list dashboard-approvals" data-test-id="dashboard-approvals">
      ${model.items.map((item) => {
        // A pending action (SPEC §18) confirms; a widget/grant approves.
        const affirmLabel =
          item.kind === "action"
            ? t("dashboard.widget.approvals.confirm")
            : t("dashboard.widget.approvals.approve");
        // Per-tool selection (SPEC §17.1): a capability row lists its requested tools
        // as pre-ticked checkboxes so the operator can grant a SUBSET; approve reads
        // the ticked set (all ticked = approve-all).
        const tools = item.kind === "capability" ? (item.tools ?? []) : [];
        const affirm =
          tools.length > 0
            ? (event: Event) => source?.onDecide(item, "approve", { tools: checkedTools(event) })
            : () => source?.onDecide(item, "approve");
        return html`
          <li class="dashboard-list__row">
            <span class="dashboard-badge dashboard-badge--muted">${kindLabel(item.kind)}</span>
            <span class="dashboard-list__label">${item.title}</span>
            ${
              item.detail
                ? html`<span class="dashboard-list__meta">${item.detail}</span>`
                : item.requestedBy
                  ? html`<span class="dashboard-list__meta"
                      >${t("dashboard.widget.approvals.requestedBy", { agent: item.requestedBy })}</span
                    >`
                  : nothing
            }
            ${
              tools.length > 0
                ? html`<ul
                    class="dashboard-approvals__tools"
                    data-test-id="dashboard-approvals-tools"
                  >
                    ${tools.map(
                      (tool) =>
                        html`<li>
                          <label
                            ><input type="checkbox" value=${tool} checked /><span
                              >${tool}</span
                            ></label
                          >
                        </li>`,
                    )}
                  </ul>`
                : nothing
            }
            <span class="dashboard-approvals__actions">
              <button
                class="bs-btn bs-btn--small bs-btn--primary"
                type="button"
                data-test-id="dashboard-approvals-approve"
                @click=${affirm}
              >
                ${affirmLabel}
              </button>
              <button
                class="bs-btn bs-btn--small"
                type="button"
                data-test-id="dashboard-approvals-deny"
                @click=${() => source?.onDecide(item, "reject")}
              >
                ${t("dashboard.widget.approvals.deny")}
              </button>
            </span>
          </li>
        `;
      })}
    </ul>
  `;
}
