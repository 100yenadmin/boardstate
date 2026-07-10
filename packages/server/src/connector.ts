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

/**
 * The store surface a connector needs for its grant (SPEC §17, M4b): read the current
 * grant status per request/tick, and register/update its `requested` grant on install.
 * `DashboardStore` satisfies this structurally.
 */
export type ConnectorGrantStore = {
  read(): Promise<{ capabilitiesRegistry?: Record<string, { status: string }> }>;
  mutate(
    mutate: (draft: { capabilitiesRegistry?: Record<string, unknown> }) => void | Promise<void>,
    opts?: { actor?: string },
  ): Promise<unknown>;
};

export type ConnectorDefinition = {
  /**
   * The connector's identity — the key its grant lands under in
   * `capabilitiesRegistry`, and the name the operator approves. `A-Z a-z 0-9 . _ -`.
   */
  name: string;
  /**
   * The store, so the connector can register its `requested` grant on install and
   * check its own grant status before serving. Omit ONLY to keep the pre-§17 behavior
   * (register + serve immediately, no grant gate) — discouraged; pass the store.
   */
  store?: ConnectorGrantStore;
  /** One-line purpose shown on the operator's approval card. */
  description?: string;
  /**
   * Read methods, keyed by an allowlisted `DATA_READ_RPC_ALLOWLIST` name. Each
   * function returns (or resolves) the CURRENT value; it runs per request, so
   * returning fresh data makes `rpc`-bound widgets live on every refresh. Served only
   * once the connector's grant is `granted`.
   */
  reads?: Record<string, (params: unknown) => unknown | Promise<unknown>>;
  /**
   * Interval broadcasts on allowlisted `STREAM_EVENT_ALLOWLIST` channels. Each
   * `payload()` runs per tick; its result is broadcast to every listener — but only
   * while the connector's grant is `granted`.
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

const CONNECTOR_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

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
  const { name, store } = definition;
  const reads = definition.reads ?? {};
  const streams = definition.streams ?? [];

  if (!CONNECTOR_NAME_PATTERN.test(name)) {
    throw new Error(`connector name "${name}" is invalid (A-Z a-z 0-9 . _ -, 1-64 chars)`);
  }
  // Gate FIRST, register after — a partially-installed connector on a bad definition
  // would be harder to reason about than a loud, atomic failure.
  const methods = Object.keys(reads);
  for (const method of methods) {
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
  const streamEvents = [...new Set(streams.map((stream) => stream.event))];

  // Register (or refresh) this connector's grant as `requested`. If a grant already
  // exists with the SAME method+stream snapshot we leave its status alone (so a
  // restart doesn't revoke an approved connector); a DIFFERENT shape re-requests
  // (SPEC §17: a connector changing what it reaches must be re-approved).
  if (store) {
    void store.mutate(
      (draft) => {
        const registry = (draft.capabilitiesRegistry ??= {});
        const existing = registry[name] as
          { status?: string; methods?: string[]; streams?: string[] } | undefined;
        const sameShape =
          existing &&
          sameSet(existing.methods ?? [], methods) &&
          sameSet(existing.streams ?? [], streamEvents);
        if (!sameShape) {
          registry[name] = {
            status: "requested",
            methods,
            streams: streamEvents,
            ...(definition.description ? { description: definition.description } : {}),
          };
        }
      },
      { actor: "system" },
    );
  }

  // Is this connector currently granted? No store ⇒ pre-§17 behavior (always on).
  const isGranted = async (): Promise<boolean> => {
    if (!store) {
      return true;
    }
    const doc = await store.read();
    return doc.capabilitiesRegistry?.[name]?.status === "granted";
  };

  for (const [method, resolve] of Object.entries(reads)) {
    host.registerRpc(
      method,
      async (ctx) => {
        try {
          if (!(await isGranted())) {
            ctx.respond(false, undefined, {
              code: "capability_pending",
              message: `connector "${name}" is awaiting operator approval`,
            });
            return;
          }
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
      void (async () => {
        try {
          if (!(await isGranted())) {
            return; // Ungranted: no data leaves the host over the stream.
          }
          host.broadcast(stream.event, stream.payload());
        } catch {
          // A failing payload/check skips the tick; the next tick tries again. A
          // connector must never take the host down.
        }
      })();
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

/** Order-insensitive equality for two string lists (grant-shape comparison). */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const set = new Set(a);
  return b.every((entry) => set.has(entry));
}
