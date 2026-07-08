// builtin:stat-card — big number + label. One binding (`value`). `props.format`
// controls presentation (usd | int | percent | raw). When the binding resolves a
// structured payload (e.g. `usage.cost`), `props.metric` selects a field from it.

import type { DashboardWidget } from "../types.js";
import { isRecord, toFiniteNumber, widgetProps } from "./types.js";

export type StatCardModel = {
  /** The display string for the primary value, or null when unavailable. */
  display: string | null;
  /** Inner label; null when it would merely repeat the widget title. */
  label: string | null;
};

/** Named metrics selectable from a structured binding payload via `props.metric`. */
function selectMetric(value: unknown, metric: string): unknown {
  if (!isRecord(value)) {
    return undefined;
  }
  const totals = isRecord(value.totals) ? value.totals : undefined;
  switch (metric) {
    case "todayCost":
      return totals?.totalCost ?? value.totalCost;
    case "todayTokens":
      return totals?.totalTokens ?? value.totalTokens;
    default:
      return value[metric];
  }
}

function formatStatValue(value: unknown, format: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const numeric = toFiniteNumber(value);
  if (format === "usd" && numeric !== undefined) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(numeric);
  }
  if (format === "percent" && numeric !== undefined) {
    return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(
      numeric,
    );
  }
  if ((format === "int" || format === "integer") && numeric !== undefined) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(numeric);
  }
  if (typeof value === "string") {
    return value;
  }
  if (numeric !== undefined) {
    return new Intl.NumberFormat("en-US").format(numeric);
  }
  return JSON.stringify(value);
}

export function mapStatCard(widget: DashboardWidget, value: unknown): StatCardModel {
  const props = widgetProps(widget);
  const metric = typeof props.metric === "string" ? props.metric : null;
  const selected = metric ? selectMetric(value, metric) : value;
  const resolved = selected !== undefined ? selected : props.value;
  const label = typeof props.label === "string" ? props.label : widget.title;
  // Drop the inner label when it merely repeats the widget title — the cell
  // already renders `widget.title` in the bar.
  const dedupedLabel = label && label !== widget.title ? label : null;
  return { display: formatStatValue(resolved, props.format), label: dedupedLabel };
}
