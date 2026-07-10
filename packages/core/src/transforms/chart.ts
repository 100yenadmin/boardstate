// builtin:chart — the pure data transform behind the dependency-free timeseries
// visuals. `mapChart` normalizes the tolerant binding value to a plain `number[]`
// and resolves the visual type; the SVG drawing itself is a host presentation
// concern that consumes this model.

import type { DashboardWidget } from "../types.js";
import { isRecord, toFiniteNumber, widgetProps } from "./types.js";

/** The visual variants a `builtin:chart` widget can render. */
export type ChartType = "line" | "bar" | "area" | "sparkline" | "gauge";

const CHART_TYPES: readonly ChartType[] = ["line", "bar", "area", "sparkline", "gauge"];
const DEFAULT_TYPE: ChartType = "line";

export type ChartModel = {
  type: ChartType;
  /** Normalized numeric series (finite only), in order. */
  values: number[];
  min: number;
  max: number;
  /**
   * Detail mode (`props.detail`) — opt-in labeled axes, gridlines, and value
   * tooltips over the default axis-light look. Ignored by `sparkline`, which
   * stays minimal by definition. Off ⇒ a byte-identical render to the old model.
   */
  detail: boolean;
  /** `sparkline` only: show the trailing value as an end-of-line label. */
  label: boolean;
};

/** Pull a numeric y from a point-like entry (`y`, else `value`). */
function pointValue(entry: unknown): number | undefined {
  if (typeof entry === "number") {
    return Number.isFinite(entry) ? entry : undefined;
  }
  if (isRecord(entry)) {
    return toFiniteNumber(entry.y) ?? toFiniteNumber(entry.value);
  }
  return undefined;
}

/** Coerce the tolerant binding value into a plain, finite `number[]`. */
export function normalizeSeries(value: unknown): number[] {
  const raw = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.points)
      ? value.points
      : [];
  const out: number[] = [];
  for (const entry of raw) {
    const n = pointValue(entry);
    if (n !== undefined) {
      out.push(n);
    }
  }
  return out;
}

function resolveType(props: Record<string, unknown>): ChartType {
  const raw = props.type;
  return typeof raw === "string" && (CHART_TYPES as readonly string[]).includes(raw)
    ? (raw as ChartType)
    : DEFAULT_TYPE;
}

export function mapChart(widget: DashboardWidget, value: unknown): ChartModel {
  const props = widgetProps(widget);
  const values = normalizeSeries(value);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  return {
    type: resolveType(props),
    values,
    min,
    max,
    detail: props.detail === true,
    label: props.label === true,
  };
}
