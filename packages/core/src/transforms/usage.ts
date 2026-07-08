// builtin:usage — a today/window cost + tokens mini-summary over `usage.cost`.
// Binding value shape: `{ totals: { totalCost, totalTokens }, days? }`.

import type { DashboardWidget } from "../types.js";
import { isRecord, toFiniteNumber } from "./types.js";

export type UsageModel = {
  cost: number;
  tokens: number;
  days: number | null;
};

export function mapUsage(_widget: DashboardWidget, value: unknown): UsageModel {
  const totals = isRecord(value) && isRecord(value.totals) ? value.totals : {};
  const cost = toFiniteNumber(totals.totalCost) ?? 0;
  const tokens = toFiniteNumber(totals.totalTokens) ?? 0;
  const days = isRecord(value) ? (toFiniteNumber(value.days) ?? null) : null;
  return { cost, tokens, days };
}
