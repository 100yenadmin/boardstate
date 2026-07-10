// A networked `Transport` over a WebSocket — the client half of the out-of-process
// seam (an in-browser dashboard talking to a Node sidecar that owns the store).
// Pairs with `attachWsTransport` in `@boardstate/server/node` (the server half).
//
// WIRE FORMAT (JSON text frames, one JSON value per frame):
//   request   (client → server): { id, method, params? }
//   response  (server → client): { id, result }  |  { id, error: { code, message } }
//   event     (server → client): { event, payload }        (no id — a broadcast)
// `id` is a per-connection monotonically increasing integer the client allocates;
// the server echoes it verbatim so a response can be matched to its request. An
// event frame carries no `id`; it is a host broadcast (e.g. `boardstate.changed`)
// re-emitted to every connected client and dispatched to `addEventListener`.
//
// Transport-native `request(method, params, ctx?)` ignores `ctx` (SPEC: the third
// arg is an in-process, host-defined identity the networked seam does not carry).
//
// Zero-dependency in the browser: it uses the platform-native `WebSocket`. On a
// Node runtime that predates the global (< 21) it falls back to an OPTIONAL dynamic
// `import("ws")`; Node ≥ 22 (this repo's floor) ships `globalThis.WebSocket`, so the
// fallback is belt-and-braces and never runs there.
//
// Reconnect is OUT OF SCOPE for v1: a dropped socket rejects every in-flight request
// and fails all later ones cleanly (`WsTransportClosedError`) — the caller owns the
// reconnect policy (build a fresh transport). No silent buffering across a drop.

import type { Transport } from "./transport.js";

/** Rejection raised for any request issued or in flight once the socket is gone. */
export class WsTransportClosedError extends Error {
  readonly code = "transport_closed";
  constructor(message = "boardstate ws transport is closed") {
    super(message);
    this.name = "WsTransportClosedError";
  }
}

/** A minimal structural view of the parts of the WebSocket API this client uses. */
interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open", fn: () => void): void;
  addEventListener(type: "close", fn: () => void): void;
  addEventListener(type: "error", fn: () => void): void;
  addEventListener(type: "message", fn: (event: { data: unknown }) => void): void;
}

/** A `Transport` over a WebSocket, plus the lifecycle handles a networked seam needs. */
export interface WsTransport extends Transport {
  /** Resolves once the socket is open (rejects if it closes/errs before opening). */
  readonly ready: Promise<void>;
  /** True once the socket has closed (locally or remotely) or failed to open. */
  readonly closed: boolean;
  /** Close the socket and reject every in-flight + future request cleanly. */
  close(): void;
}

export interface CreateWsTransportOptions {
  /**
   * Inject the WebSocket constructor (tests, or a custom Node impl). Defaults to the
   * platform-native `globalThis.WebSocket`, then an optional `import("ws")` fallback.
   */
  WebSocketImpl?: new (url: string) => WebSocketLike;
}

type Pending = { resolve: (value: unknown) => void; reject: (reason: unknown) => void };

/** Resolve a WebSocket constructor: native global first, optional `ws` import second. */
async function resolveWebSocketImpl(
  override?: new (url: string) => WebSocketLike,
): Promise<new (url: string) => WebSocketLike> {
  if (override) {
    return override;
  }
  const native = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  if (native) {
    return native;
  }
  // Node < 21 has no global WebSocket; the `ws` package is an OPTIONAL peer. This
  // path never runs on Node ≥ 22 (the repo floor) or in a browser.
  const mod = (await import(/* @vite-ignore */ "ws")) as {
    WebSocket: new (url: string) => WebSocketLike;
  };
  return mod.WebSocket;
}

/**
 * Open a networked transport to a Boardstate WS endpoint. Returns immediately with a
 * `Transport`; requests issued before the socket opens are queued and flushed on open
 * (and rejected if it closes first). `await transport.ready` to block until connected.
 */
export function createWsTransport(
  url: string,
  options: CreateWsTransportOptions = {},
): WsTransport {
  const pending = new Map<number, Pending>();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const sendQueue: string[] = [];
  let socket: WebSocketLike | null = null;
  let nextId = 1;
  let closed = false;
  let open = false;

  let resolveReady: () => void = () => {};
  let rejectReady: (reason: unknown) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // `ready` is allowed to reject; swallow the unhandled-rejection noise for callers
  // that never await it (they observe the failure via a rejected `request` instead).
  ready.catch(() => {});

  function failAll(reason: unknown): void {
    for (const entry of pending.values()) {
      entry.reject(reason);
    }
    pending.clear();
    sendQueue.length = 0;
  }

  function teardown(): void {
    if (closed) {
      return;
    }
    closed = true;
    const error = new WsTransportClosedError();
    rejectReady(error);
    failAll(error);
    try {
      socket?.close();
    } catch {
      // A socket already closing/closed throws on some impls — nothing to do.
    }
  }

  function handleMessage(raw: unknown): void {
    if (typeof raw !== "string") {
      return; // Text frames only; a binary frame is not part of the wire format.
    }
    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      return; // A non-JSON frame is ignored rather than crashing the connection.
    }
    if (typeof frame !== "object" || frame === null) {
      return;
    }
    const record = frame as {
      id?: unknown;
      result?: unknown;
      error?: { code?: unknown; message?: unknown };
      event?: unknown;
      payload?: unknown;
    };
    // A response frame is keyed by the echoed request id.
    if (typeof record.id === "number") {
      const entry = pending.get(record.id);
      if (!entry) {
        return; // Late/duplicate response for a settled request — drop it.
      }
      pending.delete(record.id);
      if (record.error) {
        const message = typeof record.error.message === "string" ? record.error.message : "boardstate error";
        const err = new Error(message) as Error & { code?: string };
        if (typeof record.error.code === "string") {
          err.code = record.error.code;
        }
        entry.reject(err);
      } else {
        entry.resolve(record.result);
      }
      return;
    }
    // An event frame carries no id: dispatch it to this connection's subscribers.
    if (typeof record.event === "string") {
      const subscribers = listeners.get(record.event);
      if (!subscribers) {
        return;
      }
      for (const fn of [...subscribers]) {
        fn(record.payload);
      }
    }
  }

  void resolveWebSocketImpl(options.WebSocketImpl)
    .then((WebSocketImpl) => {
      if (closed) {
        return; // `close()` was called before the impl resolved.
      }
      const ws = new WebSocketImpl(url);
      socket = ws;
      ws.addEventListener("open", () => {
        open = true;
        resolveReady();
        for (const frame of sendQueue) {
          ws.send(frame);
        }
        sendQueue.length = 0;
      });
      ws.addEventListener("message", (event) => handleMessage(event.data));
      ws.addEventListener("error", () => teardown());
      ws.addEventListener("close", () => teardown());
    })
    .catch((error) => {
      // The impl could not be resolved (no global WebSocket, no `ws` installed).
      closed = true;
      rejectReady(error);
      failAll(error);
    });

  return {
    get closed() {
      return closed;
    },
    ready,
    request(method: string, params?: unknown, _ctx?: unknown): Promise<unknown> {
      void _ctx; // A networked transport never inspects the host-side identity ctx.
      if (closed) {
        return Promise.reject(new WsTransportClosedError());
      }
      const id = nextId++;
      const frame = JSON.stringify({ id, method, params: params ?? {} });
      return new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        if (open && socket) {
          socket.send(frame);
        } else {
          sendQueue.push(frame); // Flushed on `open`; dropped (rejected) on close.
        }
      });
    },
    addEventListener(event: string, fn: (payload: unknown) => void): () => void {
      let subscribers = listeners.get(event);
      if (!subscribers) {
        subscribers = new Set();
        listeners.set(event, subscribers);
      }
      subscribers.add(fn);
      return () => {
        subscribers?.delete(fn);
      };
    },
    close(): void {
      teardown();
    },
  };
}
