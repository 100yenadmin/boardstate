// Leaf contract shared by write-time schema validation and resolve-time data reads.
// Kept dependency-free so schema.ts and data-read.ts never import each other.

export const DATA_READ_RPC_ALLOWLIST = [
  "health",
  "system-presence",
  "usage.status",
  "usage.cost",
  "agents.list",
  "sessions.list",
  "sessions.resolve",
  "sessions.get",
  "sessions.usage",
  "sessions.usage.timeseries",
  "sessions.usage.logs",
  "node.list",
  "node.describe",
  "cron.get",
  "cron.list",
  "cron.status",
  "cron.runs",
  // First-party broker read (SPEC §18): the operator-authored connector roster +
  // per-connector broker status. Read-only; the broker itself is host-side and
  // never enters a browser bundle.
  "dashboard.connector.list",
] as const;

// Allowlisted gateway broadcast channels a `stream` binding may subscribe to.
// A stream binding NEVER opens a new network connection — it names one of these
// events, already multiplexed over the Control UI's single gateway WebSocket, and
// the client pushes each payload to the widget. Frozen so a stream binding can
// never listen on an arbitrary/attacker-chosen channel (no SSRF, no new sockets).
export const STREAM_EVENT_ALLOWLIST = [
  "presence",
  "sessions.changed",
  "boardstate.changed",
] as const;

// Whitelisted `computed` operations. A computed binding derives its value from the
// already-resolved values of sibling bindings using EXACTLY one of these ops — a
// fixed switch, never an expression language or eval. `pick`/`format` carry a
// single string argument; every other op reduces the numeric inputs.
export const COMPUTED_OPS = [
  "sum",
  "avg",
  "min",
  "max",
  "last",
  "count",
  "pick",
  "format",
] as const;

export type ComputedOp = (typeof COMPUTED_OPS)[number];

export type DashboardBindingErrorCode =
  | "binding_denied"
  | "binding_not_found"
  | "binding_too_large"
  | "binding_invalid"
  | "binding_client_resolved";

export class DashboardBindingResolutionError extends Error {
  constructor(
    readonly code: DashboardBindingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DashboardBindingResolutionError";
  }
}

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export function normalizeDashboardDataLogicalPath(value: string): string {
  // Reject absolute paths (POSIX `/…`, Windows `C:\…`/`C:/…`, or a leading
  // slash/backslash) with a pure check so this module stays browser-safe (no
  // `node:path`). The `:` and traversal checks below cover the rest.
  const isAbsolute = value.startsWith("/") || /^([a-zA-Z]:[\\/]|[\\/])/.test(value);
  if (isAbsolute || hasControlCharacter(value)) {
    throw new DashboardBindingResolutionError("binding_invalid", "file binding path is invalid");
  }
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (
    parts.length === 0 ||
    parts.some((part) => part === "." || part === ".." || part.includes(":"))
  ) {
    throw new DashboardBindingResolutionError("binding_invalid", "file binding path is invalid");
  }
  return parts.join("/");
}
