// Multi-operator presence: ephemeral, in-memory-only viewing indicators derived
// from the `boardstate.presence` broadcast. NEVER persisted — each entry is one
// operator's latest ping (identity + tab only, never document/state). Keyed per
// host object, mirroring the store's other per-host WeakMaps.

import type { Transport } from "@boardstate/core";

type PresenceHost = object;

/** Presence pings older than this window are treated as stale and dropped. */
export const DASHBOARD_PRESENCE_TTL_MS = 30_000;

/** Broadcast channel the host emits presence pings on (SPEC §5 naming family). */
export const PRESENCE_EVENT = "boardstate.presence";

/** Presence ping payload: identity + tab only, never document/state. */
export type DashboardPresenceEvent = { operator: string; tabSlug: string; at: number };

type PresenceState = {
  /** Latest ping per operator identity. */
  entries: Map<string, { tabSlug: string; at: number }>;
  /** This client's own operator id, learned from its first self-ping echo. */
  self: string | null;
  /** Slug of an outstanding self-ping awaiting its echo, or null. */
  pendingSelfSlug: string | null;
};

const dashboardPresence = new WeakMap<PresenceHost, PresenceState>();

function getPresenceState(host: PresenceHost): PresenceState {
  let state = dashboardPresence.get(host);
  if (!state) {
    state = { entries: new Map(), self: null, pendingSelfSlug: null };
    dashboardPresence.set(host, state);
  }
  return state;
}

function prunePresence(state: PresenceState, now: number): void {
  for (const [operator, entry] of state.entries) {
    if (entry.at + DASHBOARD_PRESENCE_TTL_MS <= now) {
      state.entries.delete(operator);
    }
  }
}

/**
 * Fold a presence ping into the per-host map. The first echo of this client's own
 * ping (matching `pendingSelfSlug`) is remembered as `self` so the operator is
 * never shown as "viewing" their own tab.
 */
export function recordPresence(
  host: PresenceHost,
  event: DashboardPresenceEvent,
  now: number = Date.now(),
): void {
  const state = getPresenceState(host);
  prunePresence(state, now);
  if (state.self === null && state.pendingSelfSlug === event.tabSlug) {
    state.self = event.operator;
    state.pendingSelfSlug = null;
  }
  state.entries.set(event.operator, { tabSlug: event.tabSlug, at: event.at });
}

/** Operator ids (excluding self, excluding stale) viewing `tabSlug`, freshest first. */
export function presenceForTab(
  host: PresenceHost,
  tabSlug: string,
  now: number = Date.now(),
): string[] {
  const state = dashboardPresence.get(host);
  if (!state) {
    return [];
  }
  prunePresence(state, now);
  return [...state.entries.entries()]
    .filter(([operator, entry]) => entry.tabSlug === tabSlug && operator !== state.self)
    .toSorted((a, b) => b[1].at - a[1].at)
    .map(([operator]) => operator);
}

/** Drop all presence for a host (full teardown). */
export function clearPresence(host: PresenceHost): void {
  dashboardPresence.delete(host);
}

/**
 * Announce that this client is viewing `tabSlug`. Fire-and-forget: a failed
 * heartbeat is not a product error. The identity in the resulting broadcast is
 * resolved server-side (the payload carries only the tab slug).
 */
export function pingPresence(
  host: PresenceHost,
  transport: Transport | null,
  tabSlug: string,
): void {
  if (!transport) {
    return;
  }
  const state = getPresenceState(host);
  if (state.self === null) {
    state.pendingSelfSlug = tabSlug;
  }
  void transport.request("dashboard.presence.ping", { tabSlug }).catch(() => {
    // Best-effort presence heartbeat.
  });
}
