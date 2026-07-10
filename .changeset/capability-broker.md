---
"@boardstate/schema": minor
"@boardstate/core": minor
"@boardstate/server": major
---

The capability broker (SPEC §17, M4b) — approval-gated data-source grants. Extends
the approval model from agent-authored widget CODE to DATA sources, per ADR
`docs/decisions/0001-capability-broker.md`.

- **`@boardstate/schema`**: a top-level `capabilitiesRegistry` (optional on input;
  always present after validation) — grants keyed by connector name, each carrying
  its allowlist-validated method/stream snapshot and `requested`/`granted`/`revoked`
  status. Import re-pends every grant and strips `grantedBy`/`grantedAt` (an imported
  board carries no active capability).
- **`@boardstate/core`**: `reconcileReplaceApproval` now also forces any grant
  self-elevated to `granted` back to `requested` in the write lock, so a
  `replace`/import can never grant a capability. `normalizeWorkspace` carries the
  registry through the client read model.
- **`@boardstate/server`** (BREAKING): `installConnector` now REQUIRES `name` and
  takes `store` + `description`. On install a connector registers its grant
  `requested`; its reads answer `capability_pending` and its streams broadcast
  nothing until an operator approves. New operator-only RPC
  `dashboard.capability.approve` (in `OPERATOR_ONLY_METHODS`; never in the agent tool
  catalog) grants/revokes; revocation stops all its bindings immediately. A connector
  changing its declared shape re-requests. Omitting `store` keeps the pre-§17
  behavior (serve immediately). The reference sidecar declares + auto-approves its
  grant.

Migration: an existing `installConnector({ reads, streams })` call becomes
`installConnector({ name, store, reads, streams })` and the operator (or the host at
boot, for a single-operator localhost) approves the connector's grant.
