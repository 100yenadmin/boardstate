---
"@boardstate/core": minor
"@boardstate/server": minor
"@boardstate/lit": minor
---

Networked transport + a browser bundle — the two gaps that blocked out-of-process
hosts (e.g. an in-browser dashboard driven by a Node sidecar).

- **`@boardstate/core`** adds `createWsTransport(url)` — a `Transport` over a
  browser-native WebSocket (JSON `{id,method,params}` / `{id,result|error}` /
  `{event,payload}` frames). Zero-dependency and bundler-safe (`globalThis.WebSocket`);
  v1 has no auto-reconnect (a dropped socket rejects every request cleanly).
- **`@boardstate/server`** adds `attachWsTransport(server, host)` (from
  `@boardstate/server/node`) — an opt-in, hand-rolled RFC 6455 endpoint that dispatches
  request frames to the same in-process host surface and mirrors host broadcasts to
  connected clients. Changes no default; owns only the `upgrade` handshake on its path.
  Pinned by `@boardstate/conformance` running the full suite over a real WS pair.
- **`@boardstate/lit`** adds a self-contained browser bundle at `@boardstate/lit/browser`
  (`import "@boardstate/lit/browser"` defines the custom elements with no bundler or
  import map). `boardstate-mcp --serve` now renders the real `<boardstate-view>` when the
  bundle is built (falling back to the JSON view otherwise).
