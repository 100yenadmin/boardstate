// builtin:cron — next runs + last status per job over `cron.list`. Binding value
// shape: `{ jobs: CronJob[] }` where each job carries `state.nextRunAtMs` and
// `state.lastRunStatus`.

import type { DashboardWidget } from "../types.js";
import { isRecord, toFiniteNumber, widgetProps } from "./types.js";

const DEFAULT_LIMIT = 8;

export type CronJobModel = {
  id: string;
  name: string;
  enabled: boolean;
  nextRunAtMs: number | null;
  lastStatus: string | null;
};

export type CronModel = {
  jobs: CronJobModel[];
  total: number;
};

function jobStatus(state: Record<string, unknown> | undefined): string | null {
  if (!state) {
    return null;
  }
  const status = state.lastRunStatus ?? state.lastStatus;
  return typeof status === "string" ? status : null;
}

export function mapCron(widget: DashboardWidget, value: unknown): CronModel {
  const raw = isRecord(value) && Array.isArray(value.jobs) ? value.jobs : [];
  const limitProp = toFiniteNumber(widgetProps(widget).limit);
  const limit = limitProp && limitProp > 0 ? Math.trunc(limitProp) : DEFAULT_LIMIT;
  const records = raw.filter(isRecord);
  const jobs = records
    .map((job) => {
      const state = isRecord(job.state) ? job.state : undefined;
      return {
        id: typeof job.id === "string" ? job.id : "",
        name: typeof job.name === "string" && job.name.trim() ? job.name : (job.id as string) || "",
        enabled: job.enabled !== false,
        nextRunAtMs: state ? (toFiniteNumber(state.nextRunAtMs) ?? null) : null,
        lastStatus: jobStatus(state),
      };
    })
    .filter((job) => job.id)
    .slice(0, limit);
  return { jobs, total: records.length };
}
