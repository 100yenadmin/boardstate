// builtin:table — compact table over an array binding. The `mapTable` transform
// (row/column resolution + limit) lives in `@boardstate/core`.

import { html, nothing, type TemplateResult } from "lit";
import { mapTable, type DashboardWidget } from "@boardstate/core";
import { t } from "../strings.js";

function renderCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function renderTable(widget: DashboardWidget, value: unknown): TemplateResult {
  const model = mapTable(widget, value);
  if (model.total === 0 || model.columns.length === 0) {
    return html`<div class="dashboard-widget__placeholder">
      ${t("dashboard.widget.table.empty")}
    </div>`;
  }
  const remaining = model.total - model.shown;
  return html`
    <div class="dashboard-table">
      <table class="dashboard-table__grid">
        <thead>
          <tr>
            ${model.columns.map((column) => html`<th scope="col">${column}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${model.rows.map(
            (row) => html`
              <tr>
                ${model.columns.map((column) => html`<td>${renderCell(row[column])}</td>`)}
              </tr>
            `,
          )}
        </tbody>
      </table>
      ${
        remaining > 0
          ? html`<div class="dashboard-table__footer">
              ${t("dashboard.widget.table.more", { count: String(remaining) })}
            </div>`
          : nothing
      }
    </div>
  `;
}
