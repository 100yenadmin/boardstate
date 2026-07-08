// builtin:agent-status — a compact per-agent/session status transform (busy vs
// idle, current objective, run progress). Thin transform over the SAME
// `sessions.list` data the `sessions` builtin maps (`hasActiveRun` / `status` /
// `goal`). Binding value shape: `{ sessions: SessionRow[] }` or a bare row array.

import type { DashboardWidget } from "../types.js";
import { isRecord, toFiniteNumber, widgetProps } from "./types.js";

const DEFAULT_LIMIT = 8;

export type AgentStatusRowModel = {
  key: string;
  label: string;
  active: boolean;
  task: string | null;
  /** Fractional run progress in [0,1], derived from goal token budget, if present. */
  progress: number | null;
};

export type AgentStatusModel = {
  rows: AgentStatusRowModel[];
  activeCount: number;
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

/** Truncate to `max` characters, appending an ellipsis when clipped. */
function clampText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function rowLabel(row: Record<string, unknown>, key: string): string {
  const display = row.displayName ?? row.label ?? row.subject ?? row.channel;
  return typeof display === "string" && display.trim() ? display : key;
}

/** Current task/objective for the row: the active goal objective, if any. */
function rowTask(row: Record<string, unknown>): string | null {
  const goal = isRecord(row.goal) ? row.goal : undefined;
  const objective = goal && typeof goal.objective === "string" ? goal.objective.trim() : "";
  return objective ? clampText(objective, 100) : null;
}

/** Fractional run progress from a goal's token budget, clamped to [0,1]. */
function rowProgress(row: Record<string, unknown>): number | null {
  const goal = isRecord(row.goal) ? row.goal : undefined;
  if (!goal) {
    return null;
  }
  const used = toFiniteNumber(goal.tokensUsed);
  const budget = toFiniteNumber(goal.tokenBudget);
  if (used === undefined || budget === undefined || budget <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, used / budget));
}

export function mapAgentStatus(widget: DashboardWidget, value: unknown): AgentStatusModel {
  const raw = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.sessions)
      ? value.sessions
      : [];
  const limitProp = toFiniteNumber(widgetProps(widget).limit);
  const limit = limitProp && limitProp > 0 ? Math.trunc(limitProp) : DEFAULT_LIMIT;
  const records = raw.filter(isRecord);
  const mapped = records
    .map((row) => {
      const key = typeof row.key === "string" ? row.key : "";
      return {
        key,
        label: rowLabel(row, key),
        active: isSessionRunActive({
          hasActiveRun: typeof row.hasActiveRun === "boolean" ? row.hasActiveRun : undefined,
          status: typeof row.status === "string" ? row.status : undefined,
        }),
        task: rowTask(row),
        progress: rowProgress(row),
      };
    })
    .filter((row) => row.key);
  const activeCount = mapped.filter((row) => row.active).length;
  return { rows: mapped.slice(0, limit), activeCount, total: mapped.length };
}
