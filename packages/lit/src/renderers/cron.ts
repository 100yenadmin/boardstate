// builtin:cron — next runs + last status per job. The `mapCron` transform lives in
// `@boardstate/core`.

import { html, nothing, type TemplateResult } from "lit";
import { mapCron, type DashboardWidget } from "@boardstate/core";
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

export function renderCron(widget: DashboardWidget, value: unknown): TemplateResult {
  const model = mapCron(widget, value);
  if (model.jobs.length === 0) {
    return html`<div class="dashboard-widget__placeholder">
      ${t("dashboard.widget.cron.empty")}
    </div>`;
  }
  return html`
    <ul class="dashboard-list dashboard-cron" data-test-id="dashboard-cron">
      ${model.jobs.map(
        (job) => html`
          <li class="dashboard-list__row ${job.enabled ? "" : "dashboard-list__row--disabled"}">
            <span class="dashboard-list__label">${job.name}</span>
            <span class="dashboard-list__meta">
              ${
                job.nextRunAtMs !== null
                  ? t("dashboard.widget.cron.next", { time: formatDateTimeMs(job.nextRunAtMs) })
                  : t("dashboard.widget.cron.noNext")
              }
            </span>
            ${
              job.lastStatus
                ? html`<span class="dashboard-badge ${statusClass(job.lastStatus)}"
                    >${job.lastStatus}</span
                  >`
                : nothing
            }
          </li>
        `,
      )}
    </ul>
  `;
}
