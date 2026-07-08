// builtin:agent-status — a compact per-agent/session status list (busy vs idle,
// current objective, and run progress if present). The `mapAgentStatus` transform
// lives in `@boardstate/core`; this renders its view model.

import { html, nothing, type TemplateResult } from "lit";
import { mapAgentStatus, type DashboardWidget } from "@boardstate/core";
import { t } from "../strings.js";

export function renderAgentStatus(widget: DashboardWidget, value: unknown): TemplateResult {
  const model = mapAgentStatus(widget, value);
  if (model.rows.length === 0) {
    return html`<div class="dashboard-widget__placeholder">
      ${t("dashboard.widget.agentStatus.empty")}
    </div>`;
  }
  return html`
    <ul class="dashboard-list dashboard-agent-status" data-test-id="dashboard-agent-status">
      ${model.rows.map(
        (row) => html`
          <li class="dashboard-list__row">
            <span
              class="dashboard-dot ${row.active ? "dashboard-dot--live" : ""}"
              aria-hidden="true"
            ></span>
            <span class="dashboard-list__label">${row.label}</span>
            <span
              class="dashboard-badge ${
                row.active ? "dashboard-badge--ok" : "dashboard-badge--muted"
              }"
            >
              ${
                row.active
                  ? t("dashboard.widget.agentStatus.busy")
                  : t("dashboard.widget.agentStatus.idle")
              }
            </span>
            ${row.task ? html`<span class="dashboard-list__meta">${row.task}</span>` : nothing}
            ${
              row.progress !== null
                ? html`<span class="dashboard-list__meta"
                    >${t("dashboard.widget.agentStatus.progress", {
                      percent: String(Math.round(row.progress * 100)),
                    })}</span
                  >`
                : nothing
            }
          </li>
        `,
      )}
    </ul>
  `;
}
