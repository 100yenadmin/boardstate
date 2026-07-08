// Transport-backed workspace time-travel loaders: read-only history-ring access
// over `dashboard.workspace.history.*`. The pure diff math (snapshot-vs-current,
// first-seen version) lives in `@boardstate/core`; this module only fetches and
// normalizes. All control-plane calls go through the injected `Transport`.

import {
  normalizeWorkspace,
  type DashboardHistoryEntry,
  type DashboardWorkspace,
  type Transport,
} from "@boardstate/core";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Fetch the ring metadata (newest-first) via the read-only history.list RPC. */
export async function loadHistoryList(
  transport: Transport | null,
): Promise<DashboardHistoryEntry[]> {
  if (!transport) {
    return [];
  }
  const payload = await transport.request("dashboard.workspace.history.list", {});
  const entries = isRecord(payload) && Array.isArray(payload.entries) ? payload.entries : [];
  return entries
    .filter(isRecord)
    .map((entry) => ({
      version: typeof entry.version === "number" ? entry.version : 0,
      savedAt: typeof entry.savedAt === "string" ? entry.savedAt : "",
      bytes: typeof entry.bytes === "number" ? entry.bytes : 0,
    }))
    .filter((entry) => entry.version > 0);
}

/** Fetch one full snapshot doc via the read-only history.get RPC. */
export async function loadHistorySnapshot(
  transport: Transport | null,
  version: number,
): Promise<DashboardWorkspace | null> {
  if (!transport) {
    return null;
  }
  const payload = await transport.request("dashboard.workspace.history.get", { version });
  const doc = isRecord(payload) && "doc" in payload ? payload.doc : payload;
  return normalizeWorkspace(doc);
}
