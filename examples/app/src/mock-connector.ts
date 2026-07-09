// Mock live-data connector for the flagship example app.
//
// Registers the read-scoped `DATA_READ_RPC_ALLOWLIST` methods (§ binding-contract)
// as in-memory handlers backed by a tiny deterministic-drift engine, and runs a
// stream ticker that broadcasts the allowlisted `presence` and `sessions.changed`
// channels so `{source:"stream"}` bindings tick live. NOTHING here touches the
// workspace document — no `boardstate.changed`, no writes — so binding a widget to
// this data never triggers a full doc refetch.
//
// The host is a `ServerHost` (the in-process reference host from `@boardstate/server`
// drives it with zero transport in between): `registerRpc(name, handler, {scope})`
// wires a method, `broadcast(event, payload)` pushes a stream event. An rpc-bound
// widget resolves client-side via `transport.request(binding.method, {})` then applies
// `binding.pointer`; a stream-bound widget applies `binding.pointer` to each payload.

import type { ServerHost } from "@boardstate/server";

/** ~2s stream cadence for the `presence`/ticker channel (the live star). */
const PRESENCE_INTERVAL_MS = 2000;
/** ~4s stream cadence for the `sessions.changed` channel. */
const SESSIONS_INTERVAL_MS = 4000;
/** Rolling window length for the live `/ticker/series` chart feed. */
const SERIES_POINTS = 20;

/** Deterministic PRNG (mulberry32) so a demo run drifts identically every time. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The mutable drift state: base values nudged by a bounded random walk per tick. */
type MockState = {
  rand: () => number;
  ticks: number;
  mrr: number;
  cost: number;
  tokens: number;
  activeUsers: number;
  p95ms: number;
  revenue: number;
  series: number[];
};

function createState(): MockState {
  const rand = mulberry32(0x51ab_c0de);
  const state: MockState = {
    rand,
    ticks: 0,
    mrr: 42184,
    cost: 128.55,
    tokens: 4_218_400,
    activeUsers: 137,
    p95ms: 82,
    revenue: 2400,
    series: [],
  };
  // Pre-fill the rolling series so the very first `/ticker/series` read is 20-long.
  for (let i = 0; i < SERIES_POINTS; i += 1) {
    drift(state);
  }
  return state;
}

/** Advance the whole model one bounded step. Called on every read AND every tick. */
function drift(state: MockState): void {
  const r = state.rand;
  state.ticks += 1;
  state.mrr = clamp(state.mrr * (1 + (r() * 2 - 1) * 0.004), 30_000, 60_000);
  state.cost += r() * 0.35; // cost only accrues
  state.tokens += Math.round(r() * 8000);
  state.activeUsers = Math.max(0, Math.round(state.activeUsers + (r() * 2 - 1) * 3));
  state.p95ms = clamp(state.p95ms + (r() * 2 - 1) * 8, 40, 260);
  state.revenue = clamp(state.revenue * (1 + (r() * 2 - 1) * 0.012), 1200, 4200);
  state.series.push(Math.round(state.revenue));
  while (state.series.length > SERIES_POINTS) {
    state.series.shift();
  }
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

// ── Payload builders (shapes verified against packages/core/src/transforms/*) ──

/** Session rows whose states rotate over time (builtin:sessions / builtin:agent-status). */
const SESSION_STATUSES = ["running", "idle", "done", "queued", "error"] as const;
const SESSION_KEYS = ["s-ingest", "s-report", "s-triage", "s-deploy", "s-backfill", "s-notify"];
const SESSION_LABELS = [
  "Nightly ingest",
  "Weekly report",
  "Alert triage",
  "Prod deploy",
  "Metrics backfill",
  "Digest notify",
];

function sessionRows(state: MockState): Array<Record<string, unknown>> {
  const now = Date.now();
  return SESSION_KEYS.map((key, i) => {
    const status = SESSION_STATUSES[(i + state.ticks) % SESSION_STATUSES.length] ?? "idle";
    return {
      key,
      label: SESSION_LABELS[i] ?? key,
      status,
      hasActiveRun: status === "running",
      updatedAt: now - i * 47_000,
    };
  });
}

/** Agent rows — sessions-shaped plus a goal so builtin:agent-status shows task+progress. */
function agentRows(state: MockState): Array<Record<string, unknown>> {
  const objectives = [
    "Reconcile billing exports",
    "Summarize support inbox",
    "Rebuild search index",
    "Draft the weekly digest",
  ];
  const now = Date.now();
  return objectives.map((objective, i) => {
    const status = SESSION_STATUSES[(i + state.ticks) % SESSION_STATUSES.length] ?? "idle";
    return {
      key: `agent-${i + 1}`,
      label: `agent:${["sales", "support", "search", "ops"][i] ?? i}`,
      status,
      hasActiveRun: status === "running",
      updatedAt: now - i * 30_000,
      goal: {
        objective,
        tokensUsed: 12_000 + Math.round(state.rand() * 40_000),
        tokenBudget: 60_000,
      },
    };
  });
}

/** Presence/node rows with a drifting idle window (builtin:instances). */
function presenceRows(state: MockState): Array<Record<string, unknown>> {
  const jitter = (base: number) => Math.round(base + state.rand() * 20);
  return [
    {
      instanceId: "gateway-1",
      mode: "gateway",
      platform: "linux",
      version: "1.4.2",
      lastInputSeconds: jitter(4),
    },
    {
      instanceId: "worker-a",
      mode: "worker",
      platform: "darwin",
      version: "1.4.2",
      lastInputSeconds: jitter(18),
    },
    {
      instanceId: "worker-b",
      mode: "worker",
      platform: "linux",
      version: "1.4.1",
      lastInputSeconds: jitter(46),
    },
  ];
}

/** Cron jobs with next-run + last-status (builtin:cron). */
function cronJobs(state: MockState): Array<Record<string, unknown>> {
  const now = Date.now();
  const statuses = ["ok", "ok", "failed", "ok"];
  return ["nightly-ingest", "hourly-sync", "weekly-report", "cleanup"].map((id, i) => ({
    id,
    name: id.replaceAll("-", " "),
    enabled: i !== 3,
    state: {
      nextRunAtMs: now + (i + 1) * 900_000 + Math.round(state.rand() * 60_000),
      lastRunStatus: statuses[i] ?? "ok",
    },
  }));
}

/** Recent-run feed (builtin:activity over cron.runs). */
function cronRuns(): Array<Record<string, unknown>> {
  const now = Date.now();
  const statuses = ["ok", "ok", "failed", "ok", "ok"];
  return statuses.map((status, i) => ({
    ts: now - i * 180_000,
    jobName: ["nightly-ingest", "hourly-sync", "weekly-report", "hourly-sync", "cleanup"][i],
    status,
    summary: status === "failed" ? "timeout talking to upstream" : "completed cleanly",
  }));
}

/** The `presence` stream payload — the ticker sub-object is the live star. */
function presencePayload(state: MockState): Record<string, unknown> {
  return {
    presence: presenceRows(state),
    ticker: {
      revenue: round2(state.revenue),
      activeUsers: state.activeUsers,
      p95ms: Math.round(state.p95ms),
      series: [...state.series],
    },
  };
}

/**
 * Install the mock connector onto a host: register every allowlisted read method
 * and start the two stream tickers. Returns an uninstall fn that stops the tickers.
 */
export function installMockConnector(host: ServerHost): () => void {
  const state = createState();

  // Register a read-scoped method whose value is (re)computed — with a fresh drift
  // step — on every request, so `usage.*` (and the rest) move on each poll.
  const read = (name: string, build: (state: MockState) => unknown): void => {
    host.registerRpc(
      name,
      (opts) => {
        drift(state);
        opts.respond(true, build(state));
      },
      { scope: "read" },
    );
  };

  read("health", () => ({
    ok: true,
    status: "healthy",
    uptimeSeconds: 3600 + state.ticks,
    version: "1.4.2",
  }));
  read("system-presence", (s) => ({ presence: presenceRows(s) }));
  read("usage.status", (s) => ({
    ok: true,
    activeSessions: sessionRows(s).filter((row) => row.status === "running").length,
    queueDepth: Math.round(s.rand() * 5),
    updatedAt: Date.now(),
  }));
  read("usage.cost", (s) => ({
    totals: { totalCost: round2(s.cost), totalTokens: s.tokens },
    days: 7,
  }));
  read("agents.list", (s) => agentRows(s));
  read("sessions.list", (s) => sessionRows(s));
  read("sessions.resolve", (s) => ({ session: sessionRows(s)[0] }));
  read("sessions.get", (s) => ({ session: sessionRows(s)[0] }));
  read("sessions.usage", (s) => ({
    totals: { totalCost: round2(s.cost / 6), totalTokens: Math.round(s.tokens / 6) },
    days: 1,
  }));
  read("sessions.usage.timeseries", (s) => ({ points: [...s.series] }));
  read("sessions.usage.logs", () => ({
    entries: [
      { ts: Date.now(), level: "info", message: "tool call: usage.cost ok" },
      { ts: Date.now() - 5000, level: "info", message: "turn started" },
    ],
  }));
  read("node.list", (s) => ({ nodes: presenceRows(s) }));
  read("node.describe", (s) => ({ node: presenceRows(s)[0] }));
  read("cron.get", (s) => ({ job: cronJobs(s)[0] }));
  read("cron.list", (s) => ({ jobs: cronJobs(s) }));
  read("cron.status", (s) => ({
    ok: true,
    scheduled: cronJobs(s).length,
    running: 0,
    failing: cronJobs(s).filter(
      (job) => (job.state as { lastRunStatus?: string }).lastRunStatus === "failed",
    ).length,
  }));
  read("cron.runs", () => ({ entries: cronRuns() }));

  // Stream tickers. `presence` carries the drifting ticker (~2s); `sessions.changed`
  // rotates the session rows (~4s). Both are on the STREAM_EVENT_ALLOWLIST, so a
  // `{source:"stream"}` binding subscribes with no new socket. Never "boardstate.changed".
  const presenceTimer = setInterval(() => {
    drift(state);
    host.broadcast("presence", presencePayload(state));
  }, PRESENCE_INTERVAL_MS);

  const sessionsTimer = setInterval(() => {
    drift(state);
    host.broadcast("sessions.changed", { sessions: sessionRows(state) });
  }, SESSIONS_INTERVAL_MS);

  return () => {
    clearInterval(presenceTimer);
    clearInterval(sessionsTimer);
  };
}

/**
 * A compact system-prompt addendum: tells the composing agent this host has LIVE
 * demo data and which bindings light it up. Keep any edits <=25 body lines.
 */
export const MOCK_DATA_PROMPT = `LIVE DEMO DATA — this host serves real, drifting data. Prefer it for any
"live", "real-time", "ticker", or "monitoring" request over static values.

RPC bindings ({source:"rpc",method,pointer?}) — most useful methods:
- usage.cost      -> { totals:{ totalCost, totalTokens }, days } (drifts each call)
- sessions.list   -> [ { key,label,status,hasActiveRun,updatedAt } ] (rotating states)
- agents.list     -> [ { key,label,status,goal:{ objective,tokensUsed,tokenBudget } } ]
- cron.list       -> { jobs:[ { id,name,enabled,state:{ nextRunAtMs,lastRunStatus } } ] }
- system-presence -> { presence:[ { instanceId,platform,version,lastInputSeconds } ] }

STREAM bindings ({source:"stream",event:"presence",pointer}) tick ~2s. Pointers:
- /ticker/revenue     (number, USD)      /ticker/activeUsers (int)
- /ticker/p95ms       (number, ms)       /ticker/series      (20-point number[] — bind a chart!)
The "sessions.changed" event ({ sessions:[...] }) fires ~4s for live session lists.

Live stat card:
{"kind":"builtin:stat-card","bindings":{"value":{"source":"stream","event":"presence","pointer":"/ticker/revenue"}},"props":{"label":"Live revenue","format":"usd"}}
Live area chart (moving line):
{"kind":"builtin:chart","bindings":{"value":{"source":"stream","event":"presence","pointer":"/ticker/series"}},"props":{"type":"area"}}`;
