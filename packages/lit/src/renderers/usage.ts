// builtin:usage — a today/window cost + tokens mini-summary. The `mapUsage`
// transform lives in `@boardstate/core`.

import { html, type TemplateResult } from "lit";
import { mapUsage, type DashboardWidget } from "@boardstate/core";
import { t } from "../strings.js";
import { formatCost, formatTokens } from "./format.js";

export function renderUsage(widget: DashboardWidget, value: unknown): TemplateResult {
  const model = mapUsage(widget, value);
  return html`
    <div class="dashboard-usage" data-test-id="dashboard-usage">
      <div class="dashboard-usage__metric">
        <div class="dashboard-usage__value">${formatCost(model.cost)}</div>
        <div class="dashboard-usage__label">${t("dashboard.widget.usage.cost")}</div>
      </div>
      <div class="dashboard-usage__metric">
        <div class="dashboard-usage__value">${formatTokens(model.tokens)}</div>
        <div class="dashboard-usage__label">${t("dashboard.widget.usage.tokens")}</div>
      </div>
    </div>
  `;
}
