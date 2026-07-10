---
"@boardstate/server": minor
---

The host connector contract (SPEC §16, M4c) — wiring REAL data into live boards.

- **`installConnector(host, { reads, streams })`** on the browser-safe root entry:
  declarative allowlist-gated reads (`DATA_READ_RPC_ALLOWLIST`, scope `"read"`,
  resolved per widget refresh) + interval broadcasts on `STREAM_EVENT_ALLOWLIST`
  channels. Registration is atomic — one non-allowlisted name and nothing
  installs; `boardstate.changed` is refused as a data channel. A throwing read
  answers `connector_error`; a throwing stream payload skips the tick.
- **Fix: `DEFAULT_FORWARDED_EVENTS` now includes every `STREAM_EVENT_ALLOWLIST`
  channel** — previously a networked WS client never received `presence` /
  `sessions.changed` broadcasts by default, so stream-bound widgets silently
  never ticked over the wire (found live by the reference sidecar).
- Reference implementation: `examples/connector-sidecar/` — this machine's real
  memory + load, live in a browser board over one WebSocket. Docs:
  `docs/connectors.md`; SPEC §16.
