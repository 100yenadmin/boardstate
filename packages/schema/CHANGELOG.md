# @boardstate/schema

## 1.0.0

### Minor Changes

- [`af1df09`](https://github.com/100yenadmin/boardstate/commit/af1df09e17e36d597243a0fe78121e6cf5c9cf17) - The capability broker (SPEC §17, M4b) — approval-gated data-source grants. Extends
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

## 0.3.1

### Patch Changes

- [`9636400`](https://github.com/100yenadmin/boardstate/commit/963640033e7acdec2407dced868a4b979b2db07f) - Publish flow: `pnpm -r publish --provenance` + `changeset tag` — the third and
  loud-failing provenance attempt. `changeset publish` silently dropped provenance
  through BOTH `NPM_CONFIG_PROVENANCE` and `publishConfig.provenance`; the explicit
  `--provenance` flag errors when OIDC is unavailable instead of skipping, so this
  train either carries Sigstore attestations or the release run tells us exactly
  why not. No code changes.

## 0.2.1

### Patch Changes

- [`49655b2`](https://github.com/100yenadmin/boardstate/commit/49655b2d9826cba377dbc1afb971b57e1fae1084) - Enable npm provenance attestations declaratively (`publishConfig.provenance`):
  the 0.2.0 train's `NPM_CONFIG_PROVENANCE` env wiring was silently ignored by the
  publish path, so those tarballs carry registry signatures but no Sigstore
  attestation. The declarative flag fails loudly if OIDC is unavailable instead of
  skipping. No code changes.

## 0.1.0

### Minor Changes

- [`57888e4`](https://github.com/100yenadmin/boardstate/commit/57888e488469478876d5ebb18707456c75cb5397) - Initial release: the Boardstate protocol and runtime, extracted from the modular-dashboard system built for OpenClaw. Workspace document schema + validators, headless store with storage/transport adapters, the `dashboard.*` control plane with agent tools and jailed widget serving, the framework-free sandbox host with the postMessage bridge, the Lit reference view with 15 builtin widgets, React wrappers, an MCP server, and the transport conformance suite.

- [`d045057`](https://github.com/100yenadmin/boardstate/commit/d045057a371d2073b32e0bc7f47cfdc56bccdc54) - SPEC v0.2: §14 "Chat & agent-turn protocol" — `chat.send`/`chat.history.get`/`chat.abort`,
  the `AgentStreamEvent` stream contract (start→delta→end triads keyed by stable ids,
  raw tool-arg deltas, distinct abort semantics), `boardstate.chat.event` bus name, SSE
  mirroring rules (named events, per-event ids, heartbeats, explicitly non-resumable in
  v0.2), and normative agent-loop requirements (serial writes/parallel reads, iteration
  and token ceilings, honest retryable error classification).
