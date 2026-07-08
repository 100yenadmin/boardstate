// builtin:instances — connected instances + health over `system-presence`. Each
// entry is a live gateway/node presence row; the transform derives an idle-based
// health flag and a display id/detail.

import type { DashboardWidget } from "../types.js";
import { isRecord, toFiniteNumber, widgetProps } from "./types.js";

const DEFAULT_LIMIT = 8;
// A presence row idle beyond this window renders as degraded rather than live.
const HEALTHY_IDLE_SECONDS = 120;

export type InstanceModel = {
  id: string;
  detail: string | null;
  healthy: boolean;
  lastInputMs: number | null;
};

export type InstancesModel = {
  instances: InstanceModel[];
  total: number;
};

function instanceId(entry: Record<string, unknown>): string {
  const candidate = entry.instanceId ?? entry.host ?? entry.ip ?? entry.deviceFamily;
  return typeof candidate === "string" && candidate.trim() ? candidate : "";
}

function instanceDetail(entry: Record<string, unknown>): string | null {
  const parts = [entry.mode, entry.platform, entry.version].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function mapInstances(widget: DashboardWidget, value: unknown): InstancesModel {
  const raw = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.presence)
      ? value.presence
      : isRecord(value) && Array.isArray(value.nodes)
        ? value.nodes
        : [];
  const limitProp = toFiniteNumber(widgetProps(widget).limit);
  const limit = limitProp && limitProp > 0 ? Math.trunc(limitProp) : DEFAULT_LIMIT;
  const records = raw.filter(isRecord);
  const instances = records
    .map((entry) => {
      const lastInputSeconds = toFiniteNumber(entry.lastInputSeconds);
      return {
        id: instanceId(entry),
        detail: instanceDetail(entry),
        healthy: lastInputSeconds === undefined || lastInputSeconds <= HEALTHY_IDLE_SECONDS,
        lastInputMs: lastInputSeconds !== undefined ? lastInputSeconds * 1000 : null,
      };
    })
    .filter((entry) => entry.id)
    .slice(0, limit);
  return { instances, total: records.length };
}
