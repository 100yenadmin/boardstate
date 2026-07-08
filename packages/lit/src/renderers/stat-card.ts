// builtin:stat-card — big number + label. The `mapStatCard` transform lives in
// `@boardstate/core`; this renders its view model.

import { html, nothing, type TemplateResult } from "lit";
import { mapStatCard, type DashboardWidget } from "@boardstate/core";
import { t } from "../strings.js";

export function renderStatCard(widget: DashboardWidget, value: unknown): TemplateResult {
  const model = mapStatCard(widget, value);
  return html`
    <div class="dashboard-stat">
      <div class="dashboard-stat__value">${model.display ?? t("dashboard.widget.stat.empty")}</div>
      ${model.label ? html`<div class="dashboard-stat__label">${model.label}</div>` : nothing}
    </div>
  `;
}
