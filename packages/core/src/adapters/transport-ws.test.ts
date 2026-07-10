// Client-only unit coverage for `createWsTransport`, driven through an injected mock
// WebSocket so it needs no server (the real client↔server round-trip is pinned by the
// networked conformance run in @boardstate/conformance). Focus: the request/response
// correlation, error-code propagation, event dispatch, the pre-open send queue, and
// the reconnect-safety contract (a closed socket fails every request cleanly).

import { describe, expect, it } from "vitest";
import { createWsTransport, WsTransportClosedError } from "./transport-ws.js";

type Listener = (arg?: unknown) => void;

/** A hand-driven WebSocket stand-in: the test flips `open`/`message`/`close` itself. */
class MockWebSocket {
  static last: MockWebSocket | undefined;
  readyState = 0;
  readonly sent: string[] = [];
  private readonly handlers = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    MockWebSocket.last = this;
  }
  addEventListener(type: string, fn: Listener): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.emit("close");
  }
  private emit(type: string, arg?: unknown): void {
    for (const fn of this.handlers.get(type) ?? []) {
      fn(arg);
    }
  }
  fireOpen(): void {
    this.readyState = 1;
    this.emit("open");
  }
  fireMessage(data: string): void {
    this.emit("message", { data });
  }
  fireError(): void {
    this.emit("error");
  }
}

/** Flush the microtask + macrotask queue so the async WebSocket resolution settles. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function makeTransport() {
  MockWebSocket.last = undefined;
  const transport = createWsTransport("ws://test/ws", {
    WebSocketImpl: MockWebSocket as unknown as new (url: string) => WebSocket,
  });
  return transport;
}

/** The `id` the client stamped on its Nth outbound request frame. */
function sentId(ws: MockWebSocket, index: number): number {
  return (JSON.parse(ws.sent[index]!) as { id: number }).id;
}

describe("createWsTransport", () => {
  it("queues a pre-open request, flushes it on open, and resolves on the matching response", async () => {
    const transport = makeTransport();
    await flush();
    const ws = MockWebSocket.last!;

    // Issued before `open`: buffered, not yet on the wire.
    const pending = transport.request("dashboard.workspace.get", { a: 1 });
    expect(ws.sent).toHaveLength(0);

    ws.fireOpen();
    expect(ws.sent).toHaveLength(1);
    const frame = JSON.parse(ws.sent[0]!) as { id: number; method: string; params: unknown };
    expect(frame.method).toBe("dashboard.workspace.get");
    expect(frame.params).toEqual({ a: 1 });

    ws.fireMessage(JSON.stringify({ id: frame.id, result: { doc: "ok" } }));
    await expect(pending).resolves.toEqual({ doc: "ok" });
  });

  it("rejects with the server error code preserved", async () => {
    const transport = makeTransport();
    await flush();
    const ws = MockWebSocket.last!;
    ws.fireOpen();

    const pending = transport.request("dashboard.widget.approve", { name: "bad name!" });
    ws.fireMessage(
      JSON.stringify({ id: sentId(ws, 0), error: { code: "invalid_name", message: "name is invalid" } }),
    );
    await expect(pending).rejects.toMatchObject({ code: "invalid_name", message: "name is invalid" });
  });

  it("dispatches event frames to subscribers and stops after unsubscribe", async () => {
    const transport = makeTransport();
    await flush();
    const ws = MockWebSocket.last!;
    ws.fireOpen();

    const seen: unknown[] = [];
    const unsubscribe = transport.addEventListener("boardstate.changed", (payload) => {
      seen.push(payload);
    });
    ws.fireMessage(JSON.stringify({ event: "boardstate.changed", payload: { workspaceVersion: 2 } }));
    expect(seen).toEqual([{ workspaceVersion: 2 }]);

    unsubscribe();
    ws.fireMessage(JSON.stringify({ event: "boardstate.changed", payload: { workspaceVersion: 3 } }));
    expect(seen).toHaveLength(1);
  });

  it("rejects a request issued after close, and marks the transport closed", async () => {
    const transport = makeTransport();
    await flush();
    transport.close();
    expect(transport.closed).toBe(true);
    await expect(transport.request("dashboard.workspace.get")).rejects.toBeInstanceOf(
      WsTransportClosedError,
    );
  });

  it("rejects in-flight requests when the socket closes remotely", async () => {
    const transport = makeTransport();
    await flush();
    const ws = MockWebSocket.last!;
    ws.fireOpen();

    const pending = transport.request("dashboard.workspace.get");
    ws.close();
    await expect(pending).rejects.toMatchObject({ code: "transport_closed" });
    expect(transport.closed).toBe(true);
  });
});
