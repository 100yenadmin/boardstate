// Shared helpers for the builtin-widget data transforms. Each builtin ships a pure
// `map*` (or `evaluate*`) function that turns a resolved binding value into a view
// model; the DOM rendering lives in a host presentation package. These helpers are
// the only shared surface those transforms need.

import type { DashboardWidget } from "../types.js";

export function widgetProps(widget: DashboardWidget): Record<string, unknown> {
  return widget.props ?? {};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Coerce a possibly-string numeric field to a finite number, else undefined. */
export function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
