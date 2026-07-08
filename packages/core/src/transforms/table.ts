// builtin:table — compact table over an array binding (`rows`: file JSON array /
// static / rpc). `props.columns` is a picklist of keys to show (defaults to the
// union of the first row's keys). Shows the first N rows and a "+M more" count.

import type { DashboardWidget } from "../types.js";
import { isRecord, widgetProps } from "./types.js";

const DEFAULT_ROW_LIMIT = 8;

export type TableModel = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  shown: number;
  total: number;
};

/** Pull an array of row records out of the binding value or `props.rows`. */
function resolveRows(widget: DashboardWidget, value: unknown): Array<Record<string, unknown>> {
  const candidate = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.rows)
      ? value.rows
      : Array.isArray(widgetProps(widget).rows)
        ? (widgetProps(widget).rows as unknown[])
        : [];
  return candidate.filter(isRecord);
}

function resolveColumns(widget: DashboardWidget, rows: Array<Record<string, unknown>>): string[] {
  const declared = widgetProps(widget).columns;
  if (Array.isArray(declared)) {
    const picked = declared.filter((entry): entry is string => typeof entry === "string");
    if (picked.length > 0) {
      return picked;
    }
  }
  return rows.length > 0 ? Object.keys(rows[0]!) : [];
}

function rowLimit(widget: DashboardWidget): number {
  const raw = widgetProps(widget).limit;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? Math.min(Math.trunc(raw), 100)
    : DEFAULT_ROW_LIMIT;
}

export function mapTable(widget: DashboardWidget, value: unknown): TableModel {
  const all = resolveRows(widget, value);
  const limit = rowLimit(widget);
  const rows = all.slice(0, limit);
  return { columns: resolveColumns(widget, rows), rows, shown: rows.length, total: all.length };
}
