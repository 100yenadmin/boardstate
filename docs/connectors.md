# Host connectors — wiring real data into live boards

A board is **live** when its widgets re-render as the world changes. Boardstate keeps
every data seam out of core: the host — your app, your sidecar — supplies the data
through two allowlisted lanes, and widgets bind to them declaratively. This page is
the contract; the runnable reference is
[`examples/connector-sidecar/sidecar.mjs`](../examples/connector-sidecar/sidecar.mjs)
(~200 lines: this machine's memory + load, live in a browser board over one WebSocket).

## The two lanes

**Reads (`rpc` bindings)** — request/response, resolved when a widget refreshes.

- The host registers an allowlisted read method; a widget binds it:

  ```jsonc
  { "source": "rpc", "method": "usage.cost" }
  ```

- Only methods in `DATA_READ_RPC_ALLOWLIST` (`@boardstate/schema`) can be bound —
  the schema rejects anything else at write time, and the client resolves nothing
  it doesn't recognize.

**Streams (`stream` bindings)** — push, re-rendered per event.

- The host broadcasts on an allowlisted channel; a widget binds a JSON pointer into
  each payload:

  ```jsonc
  { "source": "stream", "event": "presence", "pointer": "/ticker/rssMb" }
  ```

- Only channels in `STREAM_EVENT_ALLOWLIST` can be bound, and the view's subscribe
  path enforces the same list (defense in depth). Never carry data on
  `boardstate.changed` — that channel signals document changes and triggers full
  refetches.

## `installConnector` — the declarative host side

```ts
import { installConnector } from "@boardstate/server"; // browser-safe

const handle = installConnector(host, {
  reads: {
    health: () => ({ ok: true, uptimeSec: process.uptime() | 0 }),
    "usage.cost": async () => readCostFromYourApi(),
  },
  streams: [{ event: "presence", intervalMs: 1000, payload: () => sampleYourMetrics() }],
});
// handle.stop() ends the interval broadcasts.
```

- Registration is **allowlist-gated and atomic**: one bad name and nothing installs.
  A connector can never widen the data surface beyond what widgets can bind.
- Read handlers run per request — return fresh data and `rpc` widgets are live on
  every refresh. A throwing read answers a `connector_error`; it never crashes the
  host. A throwing stream payload skips that tick.
- Works identically for an in-process browser host (the reference app's mock
  connector is exactly this shape) and a Node sidecar.

## Serving networked views

Pair the connector with the networked transport (`attachWsTransport` from
`@boardstate/server/node`; `createWsTransport` from `@boardstate/core`):

```ts
attachWsTransport(httpServer, host); // server half — opt-in, path-scoped, verifyClient hook
// browser: view.transport = createWsTransport("ws://host/ws")
```

`DEFAULT_FORWARDED_EVENTS` includes every `STREAM_EVENT_ALLOWLIST` channel, so a
networked view receives exactly what an in-process view can subscribe to. Networked
requests carry **no operator identity** — private tabs are filtered fail-closed for
unidentified operators; run your own auth in `verifyClient` if the endpoint isn't
localhost.

## The three gates (why this is safe by construction)

1. **Registration** — `installConnector` refuses non-allowlisted names.
2. **Write time** — the schema rejects any `rpc`/`stream` binding outside the
   allowlists, whoever writes it (human, agent, import).
3. **Subscribe/resolve time** — the client subscribes only to allowlisted channels
   and resolves only allowlisted methods.

Extending the allowlists is a schema change (a PR to `@boardstate/schema`), never a
runtime option — that's the point.
