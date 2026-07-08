// builtin:instances — connected instances + health. The `mapInstances` transform
// lives in `@boardstate/core`.

import { html, nothing, type TemplateResult } from "lit";
import { mapInstances, type DashboardWidget } from "@boardstate/core";
import { t } from "../strings.js";
import { formatMs } from "./format.js";

export function renderInstances(widget: DashboardWidget, value: unknown): TemplateResult {
  const model = mapInstances(widget, value);
  if (model.instances.length === 0) {
    return html`<div class="dashboard-widget__placeholder">
      ${t("dashboard.widget.instances.empty")}
    </div>`;
  }
  return html`
    <ul class="dashboard-list dashboard-instances" data-test-id="dashboard-instances">
      ${model.instances.map(
        (instance) => html`
          <li class="dashboard-list__row">
            <span
              class="dashboard-dot ${
                instance.healthy ? "dashboard-dot--ok" : "dashboard-dot--warn"
              }"
              aria-hidden="true"
            ></span>
            <span class="dashboard-list__label">${instance.id}</span>
            ${
              instance.detail
                ? html`<span class="dashboard-list__meta">${instance.detail}</span>`
                : nothing
            }
            ${
              instance.lastInputMs !== null
                ? html`<span class="dashboard-list__meta"
                    >${t("dashboard.widget.instances.idle", {
                      duration: formatMs(instance.lastInputMs),
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
