---
"@boardstate/broker": minor
"@boardstate/server": minor
"@boardstate/core": minor
"@boardstate/lit": minor
"@boardstate/host": patch
"@boardstate/schema": patch
---

M5 trust layer (M5b-2 + M5b-3, epic #37): the grant lifecycle for external MCP tools
and the server-enforced pending-action engine — closes #40 and #41.

**Grant lifecycle + both-direction anti-rug-pull (SPEC §17.1, #40)**

- `installBrokerActions` (`@boardstate/server/node`) registers each configured connector's
  discovered tools as a `requested` tools-only grant (explicit `methods: []`/`streams: []`,
  a `tools` id snapshot, and a subset-scoped `toolsHash`), mirroring `installConnector`'s
  request-on-install. An already-`granted` grant survives a restart; real manifest drift is
  caught at invoke time.
- Server-side anti-rug-pull: on every granted-tool call the live manifest hash is compared
  to the stored `toolsHash`; a mismatch re-pends the grant to `requested` BEFORE any call
  succeeds.
- Agent-side anti-rug-pull: `reconcileReplaceApproval` now forces a `granted` grant back to
  `requested` on ANY `tools`/`toolsHash` mutation (not just status flips) — closing the
  red-team hole where an agent could append a tool id to a granted grant through
  `workspace.replace` or import.
- Partial grants: `dashboard.capability.approve` gains an optional `tools` subset; the
  decision applies to the intersection with the requested set and the granted subset gets
  its OWN hash (`McpBroker.hashToolSubset`, injected as `capabilityToolsHash`).
- Approvals console: capability rows surface their requested tool ids for per-tool selection
  (approve-all = one click); the core transform + lit renderer + strings render it.

**Pending-action engine (SPEC §18, #41)**

- In-memory pending-action registry. `dashboard.action.invoke` AND-gates a call (granted at
  invoke time + connector configured + hash unchanged): a `readOnly` granted tool executes
  directly; a mutation parks as a `PendingActionRecord` and returns `{ pending: true, id,
  expiresAt }`. `dashboard.action.confirm`/`dashboard.action.deny` are operator-only
  (`OPERATOR_ONLY_METHODS`) — a networked client can directly execute only `readOnly` tools.
- TTL expiry (~5 min), single-shot terminal states (a replay of a terminal id errors),
  server-side invoke rate limiting (prompt-gate discipline), an audit entry per invoke +
  decision, and lifecycle broadcasts on `dashboard.action.changed`.
- `confirmAndExecute(id)` is exposed as the awaitable an agent-mediated call (M5c-1) blocks
  on: it resolves with the tool result on confirm and rejects on deny/expiry.

The engine consumes the broker through the narrow structural `ActionBroker` interface —
`@boardstate/broker` never enters `@boardstate/server` (no dependency cycle); the real
`McpBroker` fits it structurally. SPEC §17.1/§18 normative text filled where the schema
train (#39) left implementation-pending markers.
