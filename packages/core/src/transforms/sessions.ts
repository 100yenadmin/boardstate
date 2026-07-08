// builtin:sessions — latest-N sessions with a live-run flag. Thin transform over
// `sessions.list`. Binding value shape: `{ sessions: SessionRow[] }` or a bare row
// array. Row → chat-link glue is a host presentation concern.

import type { DashboardWidget } from "../types.js";
import { isRecord, toFiniteNumber, widgetProps } from "./types.js";

const DEFAULT_LIMIT = 6;

export type SessionsRowModel = {
  key: string;
  label: string;
  active: boolean;
  updatedAt: number | null;
};

export type SessionsModel = {
  rows: SessionsRowModel[];
  total: number;
};

/** Live-run predicate: a non-`running` status is inactive; else fall back to `hasActiveRun`. */
function isSessionRunActive(state: { hasActiveRun?: boolean; status?: string }): boolean {
  if (state.status && state.status !== "running") {
    return false;
  }
  if (typeof state.hasActiveRun === "boolean") {
    return state.hasActiveRun;
  }
  return state.status === "running";
}

function rowLabel(row: Record<string, unknown>, key: string): string {
  const display = row.displayName ?? row.label ?? row.subject ?? row.channel;
  return typeof display === "string" && display.trim() ? display : key;
}

export function mapSessions(widget: DashboardWidget, value: unknown): SessionsModel {
  const raw = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.sessions)
      ? value.sessions
      : [];
  const limitProp = toFiniteNumber(widgetProps(widget).limit);
  const limit = limitProp && limitProp > 0 ? Math.trunc(limitProp) : DEFAULT_LIMIT;
  const records = raw.filter(isRecord);
  const rows = records
    .map((row) => {
      const key = typeof row.key === "string" ? row.key : "";
      return {
        key,
        label: rowLabel(row, key),
        active: isSessionRunActive({
          hasActiveRun: typeof row.hasActiveRun === "boolean" ? row.hasActiveRun : undefined,
          status: typeof row.status === "string" ? row.status : undefined,
        }),
        updatedAt: toFiniteNumber(row.updatedAt) ?? null,
      };
    })
    .filter((row) => row.key)
    .slice(0, limit);
  return { rows, total: records.length };
}
