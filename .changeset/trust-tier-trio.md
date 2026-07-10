---
"@boardstate/schema": minor
"@boardstate/core": minor
"@boardstate/server": minor
"@boardstate/host": minor
"@boardstate/lit": minor
"@boardstate/agent": minor
---

Trust-tier trio on the §17 capability grant + §18 pending-action spine: per-tool
auto-confirm (#62), grant TTLs (#64), and async pending actions (#63).

- **Per-tool auto-confirm (#62, SPEC §17.2).** A grant gains an optional operator-set
  `autoConfirm?: string[]` (⊆ its granted `tools`). A non-`readOnly` tool in the set
  executes DIRECTLY on invoke — no park — audited `auto-confirmed` and broadcasting
  `dashboard.action.changed {status:"confirmed", autoConfirmed:true}`, still rate-limited.
  Operator-only (the approve verb); wiped on every re-pend (manifest drift, `replace`/import
  surface mutation, `tool_search` request, TTL expiry, revoke).
- **Grant TTLs (#64, SPEC §17).** A grant gains an optional `expiresAt?: ISO-8601`,
  operator-set at approve time and required future-dated. After expiry the grant re-pends to
  `requested` (tools drop, `autoConfirm` clears) — swept ON READ (fail-closed at every
  reader incl. the confirm seam: park-then-expire-then-confirm is refused) plus a coarse host
  timer. The clock is injectable.
- **Async pending actions (#63, SPEC §18.4).** New `asyncActions` install option (default
  false, blocking path byte-identical): an agent-invoked mutation returns a framed
  `{parked:true, id, expiresAt}` immediately and the turn ends. Settlements are delivered via
  a new `onActionSettled(record, result)` engine hook; `@boardstate/agent` adds an opt-in
  `createActionSettlementWake` that enqueues ONE follow-up turn per settlement (framed
  untrusted, no recursive cascade).
- **Approvals widget (#62/#64).** Per-tool auto-confirm toggles + a TTL field on capability
  rows, a live "expires in" countdown, and renew/revoke on granted-grant management rows.
