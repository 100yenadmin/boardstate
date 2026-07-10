// The server half of the networked `Transport` (SPEC's out-of-process seam): a
// WebSocket endpoint that lets an out-of-process client (an in-browser dashboard, a
// Hermes plugin, …) drive the SAME in-process host the CLI/MCP/demo drive — the
// control-plane surface `createInProcessHost` / `registerBoardstateRpc` expose. It is
// OPT-IN: attach it to an existing `http.Server` next to the widget-asset route; it
// changes no default and owns only the `upgrade` handshake on its configured path.
//
// WIRE FORMAT (JSON text frames, one JSON value per frame) — the exact contract the
// client (`createWsTransport` in @boardstate/core) speaks:
//   request   (client → server): { id, method, params? }
//   response  (server → client): { id, result }  |  { id, error: { code, message } }
//   event     (server → client): { event, payload }        (no id — a host broadcast)
// Each inbound request is dispatched to `host.request(method, params)`; its resolution
// is sent back under the echoed `id`. Every host broadcast in `forwardEvents` (default:
// the four protocol broadcasts) is re-emitted to every connected client as an event
// frame — so a networked client sees `boardstate.changed` / chat / presence live, just
// as an in-process one does over `host.addEventListener`.
//
// Zero-dependency: a minimal RFC 6455 text-frame codec (handshake, masked client
// frames, unmasked server frames, fragmentation reassembly, ping/pong, close) —
// hand-rolled in the same spirit as this package's hand-rolled SSE + path jail, so
// no `ws` dependency lands in a host that only needs JSON text frames.
//
// Auth is the HOST's job (as with the widget route): gate the `upgrade` before
// attaching, or pass `verifyClient`. Reconnect is the CLIENT's job (v1: no server-side
// session resume — a dropped socket simply drops; the client opens a fresh one).

import { createHash } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { CHAT_EVENT, STREAM_EVENT_ALLOWLIST } from "@boardstate/schema";
import { formatError, type InProcessHost } from "./host.js";

/** RFC 6455 §1.3 magic GUID used to derive the `Sec-WebSocket-Accept` value. */
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/**
 * The host broadcasts a networked client mirrors by default: the protocol events
 * (SPEC §5, §10, §14, presence) PLUS every `STREAM_EVENT_ALLOWLIST` channel — a
 * networked view must be able to receive exactly what an in-process view can
 * subscribe to, or `stream`-bound widgets silently never tick over the wire
 * (found live by the reference connector sidecar, M4c).
 */
export const DEFAULT_FORWARDED_EVENTS: readonly string[] = [
  ...new Set([
    "boardstate.changed",
    "boardstate.widget-state.changed",
    "boardstate.presence",
    CHAT_EVENT,
    ...STREAM_EVENT_ALLOWLIST,
  ]),
];

/** Guard against an unbounded inbound message pinning memory (mirrors the /rpc cap). */
const MAX_MESSAGE_BYTES = 1024 * 1024;

// WebSocket opcodes (RFC 6455 §5.2).
const OP_CONTINUATION = 0x0;
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

export type AttachWsTransportOptions = {
  /** Upgrade path this endpoint owns (default `/ws`). A mismatch destroys the socket. */
  path?: string;
  /**
   * Which host broadcasts to mirror to connected clients. Defaults to
   * {@link DEFAULT_FORWARDED_EVENTS}. Pass an explicit list to narrow/extend it.
   */
  forwardEvents?: readonly string[];
  /**
   * Optional per-connection gate. Return false to reject the handshake (426). Run
   * your own auth here; absent ⇒ every upgrade on `path` is accepted.
   */
  verifyClient?: (req: IncomingMessage) => boolean;
};

export type WsTransportHandle = {
  /** Number of currently connected clients. */
  readonly connections: number;
  /** Detach the upgrade handler and close every open connection. */
  close(): void;
};

/**
 * Attach a Boardstate WebSocket endpoint to an existing HTTP server. Returns a handle
 * whose `close()` detaches the handshake and drops all connections. Composes with the
 * widget-asset HTTP route on the same server — it only claims the `upgrade` event.
 */
export function attachWsTransport(
  httpServer: HttpServer,
  host: InProcessHost,
  options: AttachWsTransportOptions = {},
): WsTransportHandle {
  const path = options.path ?? "/ws";
  const forwardEvents = options.forwardEvents ?? DEFAULT_FORWARDED_EVENTS;
  const connections = new Set<Connection>();

  const onUpgrade = (req: IncomingMessage, socket: Duplex): void => {
    // Only claim upgrades on our path; a mismatch is not ours to answer — destroy it.
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname !== path) {
      socket.destroy();
      return;
    }
    const key = req.headers["sec-websocket-key"];
    const upgradeHeader = String(req.headers["upgrade"] ?? "").toLowerCase();
    if (upgradeHeader !== "websocket" || typeof key !== "string") {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    if (options.verifyClient && !options.verifyClient(req)) {
      socket.end("HTTP/1.1 426 Upgrade Required\r\n\r\n");
      return;
    }
    const accept = createHash("sha1")
      .update(key + WS_GUID)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );

    const connection = new Connection(socket, host, forwardEvents, () =>
      connections.delete(connection),
    );
    connections.add(connection);
  };

  httpServer.on("upgrade", onUpgrade);

  return {
    get connections() {
      return connections.size;
    },
    close() {
      httpServer.off("upgrade", onUpgrade);
      // Snapshot: each close() removes the connection from the set mid-iteration.
      // oxlint-disable-next-line no-useless-spread
      for (const connection of [...connections]) {
        connection.close();
      }
    },
  };
}

/** One live client: the frame codec, the request→host dispatch, the event mirror. */
class Connection {
  private buffer: Buffer = Buffer.alloc(0);
  /** Reassembly state for a fragmented application message. */
  private fragments: Buffer[] = [];
  private fragmentOpcode = 0;
  private fragmentBytes = 0;
  private closedFlag = false;
  private readonly unsubscribes: Array<() => void>;

  constructor(
    private readonly socket: Duplex,
    private readonly host: InProcessHost,
    forwardEvents: readonly string[],
    private readonly onClose: () => void,
  ) {
    // Mirror each host broadcast to this client as an `{ event, payload }` frame.
    this.unsubscribes = forwardEvents.map((event) =>
      host.addEventListener(event, (payload) => {
        this.sendJson({ event, payload });
      }),
    );
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("close", () => this.dispose());
    socket.on("error", () => this.dispose());
  }

  /** Serialize a wire value and write it as a single unmasked text frame. */
  private sendJson(value: unknown): void {
    if (this.closedFlag) {
      return;
    }
    let text: string;
    try {
      text = JSON.stringify(value);
    } catch {
      return; // A non-serializable payload is skipped rather than killing the socket.
    }
    this.socket.write(encodeFrame(OP_TEXT, Buffer.from(text, "utf8")));
  }

  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    // Parse every complete frame currently buffered; leave a partial for the next chunk.
    for (;;) {
      const result = decodeFrame(this.buffer);
      if (result.status === "incomplete") {
        return;
      }
      if (result.status === "error") {
        this.fail(); // Unmasked or over-cap frame — refuse the connection (1002).
        return;
      }
      this.buffer = this.buffer.subarray(result.frame.consumed);
      this.handleFrame(result.frame.fin, result.frame.opcode, result.frame.payload);
    }
  }

  private handleFrame(fin: boolean, opcode: number, payload: Buffer): void {
    switch (opcode) {
      case OP_PING:
        this.socket.write(encodeFrame(OP_PONG, payload));
        return;
      case OP_PONG:
        return; // Unsolicited pong — nothing to do.
      case OP_CLOSE:
        // Echo the close frame, then tear down (RFC 6455 §5.5.1).
        if (!this.closedFlag) {
          this.socket.write(encodeFrame(OP_CLOSE, Buffer.alloc(0)));
        }
        this.dispose();
        return;
      case OP_BINARY:
        // Binary frames are not part of the JSON wire format — refuse (1003).
        this.fail();
        return;
      case OP_TEXT:
      case OP_CONTINUATION: {
        if (opcode === OP_TEXT) {
          this.fragmentOpcode = OP_TEXT;
        }
        this.fragments.push(payload);
        this.fragmentBytes += payload.length;
        if (this.fragmentBytes > MAX_MESSAGE_BYTES) {
          this.fail();
          return;
        }
        if (!fin) {
          return; // Await continuation frames.
        }
        const message = Buffer.concat(this.fragments).toString("utf8");
        this.fragments = [];
        this.fragmentBytes = 0;
        this.fragmentOpcode = 0;
        void this.dispatch(message);
        return;
      }
      default:
        this.fail();
    }
  }

  /** Parse a request frame and dispatch it to the host, echoing the result under `id`. */
  private async dispatch(raw: string): Promise<void> {
    let frame: { id?: unknown; method?: unknown; params?: unknown };
    try {
      frame = JSON.parse(raw) as { id?: unknown; method?: unknown; params?: unknown };
    } catch {
      return; // A non-JSON text frame is ignored (no id to answer under).
    }
    const id = frame.id;
    if (typeof id !== "number" && typeof id !== "string") {
      return; // Every request MUST carry an id; a frame without one is unanswerable.
    }
    if (typeof frame.method !== "string") {
      this.sendJson({ id, error: { code: "bad_request", message: "method is required" } });
      return;
    }
    try {
      const result = await this.host.request(frame.method, frame.params);
      this.sendJson({ id, result });
    } catch (error) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "boardstate_error";
      this.sendJson({ id, error: { code, message: formatError(error) } });
    }
  }

  /** Close on a protocol violation (send a bare close frame, then dispose). */
  private fail(): void {
    if (!this.closedFlag) {
      this.socket.write(encodeFrame(OP_CLOSE, Buffer.alloc(0)));
    }
    this.dispose();
  }

  /** Public close: send a close frame then tear the connection down. */
  close(): void {
    this.fail();
  }

  /** Idempotent teardown: unsubscribe from host events and destroy the socket. */
  private dispose(): void {
    if (this.closedFlag) {
      return;
    }
    this.closedFlag = true;
    for (const unsubscribe of this.unsubscribes) {
      unsubscribe();
    }
    this.onClose();
    this.socket.destroy();
  }
}

/**
 * Encode one unmasked frame (server → client). RFC 6455 §5.2: FIN set, no mask, the
 * three payload-length forms (7-bit, 16-bit, 64-bit).
 */
function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    // 64-bit length; JS payloads never exceed 2^53, so the high word is 0.
    header.writeUInt32BE(Math.floor(length / 0x100000000), 2);
    header.writeUInt32BE(length >>> 0, 6);
  }
  return Buffer.concat([header, payload]);
}

type DecodedFrame = { fin: boolean; opcode: number; payload: Buffer; consumed: number };

/**
 * Decode-one-frame outcome: a decoded frame, a not-yet-complete buffer (keep reading),
 * or a protocol violation the caller must close on. Distinguishing "incomplete" from
 * "error" is what lets `onData` refuse a hostile frame instead of buffering toward it.
 */
type FrameResult =
  { status: "ok"; frame: DecodedFrame } | { status: "incomplete" } | { status: "error" };

/**
 * Decode one frame from the head of `buffer`. Client → server frames MUST be masked
 * (RFC 6455 §5.1) and MUST NOT declare a payload larger than the message cap — either
 * is a protocol violation returned as `error`. The mask is applied here so the caller
 * sees plaintext. `consumed` is how many bytes the frame occupied.
 */
function decodeFrame(buffer: Buffer): FrameResult {
  if (buffer.length < 2) {
    return { status: "incomplete" };
  }
  const byte0 = buffer[0]!;
  const byte1 = buffer[1]!;
  const fin = (byte0 & 0x80) !== 0;
  const opcode = byte0 & 0x0f;
  const masked = (byte1 & 0x80) !== 0;
  // RFC 6455 §5.1: every frame from a client MUST be masked. An unmasked frame is a
  // protocol violation — refuse it rather than read its payload as plaintext.
  if (!masked) {
    return { status: "error" };
  }
  let length = byte1 & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < offset + 2) {
      return { status: "incomplete" };
    }
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) {
      return { status: "incomplete" };
    }
    const high = buffer.readUInt32BE(offset);
    const low = buffer.readUInt32BE(offset + 4);
    length = high * 0x100000000 + low;
    offset += 8;
  }

  // Bound the DECLARED payload before buffering toward it: a single frame can never
  // exceed the whole-message cap, so a larger claim is refused NOW — otherwise a client
  // could claim a huge length and dribble bytes, growing `Connection.buffer` unbounded
  // before the post-reassembly cap ever fires (a memory-DoS).
  if (length > MAX_MESSAGE_BYTES) {
    return { status: "error" };
  }
  if (buffer.length < offset + 4) {
    return { status: "incomplete" }; // Mask key not fully arrived yet.
  }
  const maskKey = buffer.subarray(offset, offset + 4);
  offset += 4;
  if (buffer.length < offset + length) {
    return { status: "incomplete" }; // Payload not fully arrived yet.
  }
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  for (let i = 0; i < payload.length; i += 1) {
    payload[i]! ^= maskKey[i & 3]!;
  }
  return { status: "ok", frame: { fin, opcode, payload, consumed: offset + length } };
}
