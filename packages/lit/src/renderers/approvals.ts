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
      ${model.items.map(
        (item) => html`
          <li class="dashboard-list__row">
            <span class="dashboard-badge dashboard-badge--muted"
              >${t("dashboard.widget.approvals.kind.widget")}</span
            >
            <span class="dashboard-list__label">${item.title}</span>
            ${
              item.requestedBy
                ? html`<span class="dashboard-list__meta"
                    >${t("dashboard.widget.approvals.requestedBy", { agent: item.requestedBy })}</span
                  >`
                : nothing
            }
            <span class="dashboard-approvals__actions">
              <button
                class="bs-btn bs-btn--small bs-btn--primary"
                type="button"
                data-test-id="dashboard-approvals-approve"
                @click=${() => source?.onDecide(item, "approve")}
              >
                ${t("dashboard.widget.approvals.approve")}
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
        `,
      )}
    </ul>
  `;
}
