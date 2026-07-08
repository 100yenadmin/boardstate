// builtin:activity — a compact recent-activity feed over `cron.runs`. Binding
// value shape: `{ entries: CronRunLogEntry[] }`. Each entry is a completed run
// with a ts, job name, status, and optional summary.

import type { DashboardWidget } from "../types.js";
import { isRecord, toFiniteNumber, widgetProps } from "./types.js";

const DEFAULT_LIMIT = 20;

export type ActivityEntryModel = {
  ts: number | null;
  title: string;
  detail: string | null;
  status: string | null;
};

export type ActivityModel = {
  entries: ActivityEntryModel[];
  total: number;
};

/** Truncate a summary/error line to a bounded length with an ellipsis. */
function clampText(value: string, max = 120): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function entryTitle(entry: Record<string, unknown>): string {
  const name = entry.jobName ?? entry.jobId ?? entry.action;
  return typeof name === "string" && name.trim() ? name : "run";
}

export function mapActivity(widget: DashboardWidget, value: unknown): ActivityModel {
  const raw = isRecord(value) && Array.isArray(value.entries) ? value.entries : [];
  const limitProp = toFiniteNumber(widgetProps(widget).limit);
  const limit = limitProp && limitProp > 0 ? Math.trunc(limitProp) : DEFAULT_LIMIT;
  const records = raw.filter(isRecord);
  const entries = records
    .map((entry) => ({
      ts: toFiniteNumber(entry.ts) ?? null,
      title: entryTitle(entry),
      detail:
        typeof entry.summary === "string" && entry.summary.trim()
          ? clampText(entry.summary, 120)
          : typeof entry.error === "string" && entry.error.trim()
            ? clampText(entry.error, 120)
            : null,
      status: typeof entry.status === "string" ? entry.status : null,
    }))
    .slice(0, limit);
  return { entries, total: records.length };
}
