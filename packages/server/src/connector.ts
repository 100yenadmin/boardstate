// The host connector contract (SPEC §16, M4c): how a host wires REAL data into a
// board's `rpc` and `stream` bindings. Two lanes, both already allowlist-gated by the
// schema at write time and by the client at subscribe time — this helper makes the
// host side declarative and adds the same gate at REGISTRATION time (three layers,
// all fail-closed):
//
//   reads   — allowlisted read methods (`DATA_READ_RPC_ALLOWLIST`), each a function
//             returning the current value; a widget binds
//             `{ source: "rpc", method: "usage.cost" }` and resolves it per refresh.
//   streams — allowlisted broadcast channels (`STREAM_EVENT_ALLOWLIST`), each a
//             function producing a payload pushed on an interval; a widget binds
//             `{ source: "stream", event: "presence", pointer: "/…" }` and re-renders
//             per push. NEVER `boardstate.changed` payload-carrying data — that
//             channel is the doc-changed signal and triggers full refetches.
//
// Browser-safe: `setInterval` + the host surface only. Works identically for an
// in-process browser host and a Node sidecar (pair with `attachWsTransport` from
// `@boardstate/server/node` to serve networked clients).

import { DATA_READ_RPC_ALLOWLIST, STREAM_EVENT_ALLOWLIST } from "@boardstate/schema";
import { formatError } from "./host.js";

/** The narrow host surface a connector needs (both InProcessHost and ServerHost fit). */
export type ConnectorHost = {
  registerRpc(
    name: string,
    handler: (ctx: {
      params: unknown;
      respond: (ok: boolean, result?: unknown, error?: { code: string; message: string }) => void;
    }) => void | Promise<void>,
    opts: { scope: "read" },
  ): void;
  broadcast(event: string, payload: unknown): void;
};

export type ConnectorDefinition = {
  /**
   * Read methods, keyed by an allowlisted `DATA_READ_RPC_ALLOWLIST` name. Each
   * function returns (or resolves) the CURRENT value; it runs per request, so
   * returning fresh data makes `rpc`-bound widgets live on every refresh.
   */
  reads?: Record<string, (params: unknown) => unknown | Promise<unknown>>;
  /**
   * Interval broadcasts on allowlisted `STREAM_EVENT_ALLOWLIST` channels. Each
   * `payload()` runs per tick; its result is broadcast to every listener (in-process
   * views and networked WS clients alike).
   */
  streams?: Array<{
    event: string;
    intervalMs: number;
    payload: () => unknown;
  }>;
};

export type ConnectorHandle = {
  /** Stop every interval broadcast. (Registered reads stay — hosts have no unregister.) */
  stop(): void;
};

/**
 * Install a data connector on a host: register its read methods (scope `"read"`,
 * allowlist-enforced) and start its interval broadcasts (allowlist-enforced).
 * Throws on a non-allowlisted name — a connector can never widen the data surface
 * beyond what the schema lets widgets bind to.
 */
export function installConnector(
  host: ConnectorHost,
  definition: ConnectorDefinition,
): ConnectorHandle {
  const reads = definition.reads ?? {};
  const streams = definition.streams ?? [];

  // Gate FIRST, register after — a partially-installed connector on a bad definition
  // would be harder to reason about than a loud, atomic failure.
  for (const method of Object.keys(reads)) {
    if (!(DATA_READ_RPC_ALLOWLIST as readonly string[]).includes(method)) {
      throw new Error(
        `connector read "${method}" is not in DATA_READ_RPC_ALLOWLIST — widgets cannot bind it`,
      );
    }
  }
  for (const stream of streams) {
    if (!(STREAM_EVENT_ALLOWLIST as readonly string[]).includes(stream.event)) {
      throw new Error(
        `connector stream "${stream.event}" is not in STREAM_EVENT_ALLOWLIST — views will not subscribe to it`,
      );
    }
    if (stream.event === "boardstate.changed") {
      throw new Error(
        'connector streams must not broadcast "boardstate.changed" — it signals document changes and triggers full refetches',
      );
    }
    if (!Number.isFinite(stream.intervalMs) || stream.intervalMs < 100) {
      throw new Error(`connector stream "${stream.event}" intervalMs must be >= 100`);
    }
  }

  for (const [method, resolve] of Object.entries(reads)) {
    host.registerRpc(
      method,
      async (ctx) => {
        try {
          ctx.respond(true, await resolve(ctx.params));
        } catch (error) {
          ctx.respond(false, undefined, { code: "connector_error", message: formatError(error) });
        }
      },
      { scope: "read" },
    );
  }

  const timers = streams.map((stream) =>
    setInterval(() => {
      try {
        host.broadcast(stream.event, stream.payload());
      } catch {
        // A failing payload skips the tick; the next tick tries again. A connector
        // must never take the host down.
      }
    }, stream.intervalMs),
  );

  return {
    stop() {
      for (const timer of timers) {
        clearInterval(timer);
      }
    },
  };
}
