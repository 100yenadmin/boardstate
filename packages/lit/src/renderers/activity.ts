// builtin:activity — a compact recent-activity feed. The `mapActivity` transform
// lives in `@boardstate/core`.

import { html, nothing, type TemplateResult } from "lit";
import { mapActivity, type DashboardWidget } from "@boardstate/core";
import { t } from "../strings.js";
import { formatDateTimeMs } from "./format.js";

function statusClass(status: string | null): string {
  if (status === "ok") {
    return "dashboard-badge--ok";
  }
  if (status === "error") {
    return "dashboard-badge--error";
  }
  return "dashboard-badge--muted";
}

export function renderActivity(widget: DashboardWidget, value: unknown): TemplateResult {
  const model = mapActivity(widget, value);
  if (model.entries.length === 0) {
    return html`<div class="dashboard-widget__placeholder">
      ${t("dashboard.widget.activity.empty")}
    </div>`;
  }
  return html`
    <ul class="dashboard-feed" data-test-id="dashboard-activity">
      ${model.entries.map(
        (entry) => html`
          <li class="dashboard-feed__row">
            <div class="dashboard-feed__head">
              <span class="dashboard-feed__title">${entry.title}</span>
              ${
                entry.status
                  ? html`<span class="dashboard-badge ${statusClass(entry.status)}"
                      >${entry.status}</span
                    >`
                  : nothing
              }
              ${
                entry.ts !== null
                  ? html`<span class="dashboard-feed__time">${formatDateTimeMs(entry.ts)}</span>`
                  : nothing
              }
            </div>
            ${
              entry.detail
                ? html`<div class="dashboard-feed__detail">${entry.detail}</div>`
                : nothing
            }
          </li>
        `,
      )}
    </ul>
  `;
}
