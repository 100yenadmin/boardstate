# connector-sidecar — real data, live board, one WebSocket

The reference host connector (SPEC §16, [docs/connectors.md](../../docs/connectors.md)):
a ~200-line Node sidecar that serves a live Boardstate board of **this machine's actual
memory and load**, sampled every second, to any browser over the networked WebSocket
transport.

```sh
pnpm build                                     # once, from the repo root
node examples/connector-sidecar/sidecar.mjs    # then open http://localhost:4600
```

What you're seeing, layer by layer:

1. `installConnector` (`@boardstate/server`) broadcasts real metrics on the
   allowlisted `presence` channel and answers the allowlisted `health` read.
2. `attachWsTransport` (`@boardstate/server/node`) carries the control plane over one
   WebSocket — the same `dashboard.*` surface an agent drives.
3. The board's widgets carry plain `stream`/`rpc` bindings; the view re-renders per
   push. No polling, no sockets in core, no custom protocol.
