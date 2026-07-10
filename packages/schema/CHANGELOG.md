# @boardstate/schema

## 1.8.0

### Minor Changes

- [#75](https://github.com/100yenadmin/boardstate/pull/75) [`6eb44b3`](https://github.com/100yenadmin/boardstate/commit/6eb44b389b14903662eeef0cf9ea515f98ee8803) Thanks [@100yenadmin](https://github.com/100yenadmin)! - Installable template recipes ([#60](https://github.com/100yenadmin/boardstate/issues/60)) + board-as-agent-memory ([#61](https://github.com/100yenadmin/boardstate/issues/61)).

  - **Template recipes ([#60](https://github.com/100yenadmin/boardstate/issues/60), `@boardstate/schema` + `@boardstate/core`).** A new
    `TemplateRecipe` format (`validateRecipe`) = a workspace doc + a `grantsManifest`
    (connector → requested tools with human labels), schema-validated and static-hostable
    (the registry index gains a `recipes[]` array). **Install = import:** the board is applied
    through the existing distribution re-pend seam (`buildRecipeImportDoc` →
    `sanitizeImportedWorkspace` → `dashboard.workspace.replace`), so every manifest grant
    lands `requested` and custom widgets `pending` — a recipe can **never** arrive
    pre-granted (proven at store ground truth through `reconcileReplaceApproval`). Ships two
    operational recipes — a keyless **Ops board** (the operational-demo's fake OfficeCLI
    connector, live end to end) and a **SaaS metrics + actions** board (builtins + an
    aggregator-shaped manifest) — plus an **Agent memory** template.
  - **Templates gallery tab ([#60](https://github.com/100yenadmin/boardstate/issues/60), `@boardstate/lit`).** The widget-gallery dialog grows a
    **Templates** tab that browses recipes and renders each recipe's honest "this board will
    ask for these tools" grant list before install; installing navigates to the board and the
    approvals widget surfaces the pending grant cards. New locale keys land in all five
    complete locales.
  - **Board-as-memory ([#61](https://github.com/100yenadmin/boardstate/issues/61), `@boardstate/agent`).** Opt-in `memory: "board"` on
    `createAgentChatAgent`: the system prompt gains the memory conventions
    (`buildSystemPrompt(tools, { memory: "board" })` / `MEMORY_CONVENTIONS`) and the runner
    **primes each turn** by reading a `memory` tab through the existing
    `dashboard_workspace_get` verb (no new tools). Additive and default-off — the prompt is
    byte-identical when off. See `docs/board-as-memory.md`.

- [#74](https://github.com/100yenadmin/boardstate/pull/74) [`ddc2710`](https://github.com/100yenadmin/boardstate/commit/ddc2710ab1532ef66351cd6bd991ddf6568e9cc9) Thanks [@100yenadmin](https://github.com/100yenadmin)! - Multi-agent workspaces ([#59](https://github.com/100yenadmin/boardstate/issues/59), SPEC §17.3): several agents sharing one board, distinguishable
  and separately governed.

  - **Per-agent grant scoping (schema + engine).** A capability grant gains an optional
    operator-set `agents?: string[]` — the ACTOR dimension of the AND-gate. Absent ⇒ all agents
    (back-compat, zero migration); present ⇒ only those agent actors pass, at BOTH tool-set
    assembly (the agent-tool adapter surfaces a scoped grant only to a bound, listed agent —
    covering the direct `readOnly` path) and invoke/read time (`dashboard.action.invoke` /
    `dashboard.connector.read` fail-safe recheck). Operator-set ONLY (the approve verb);
    `tool_search` REQUEST / `workspace.replace` / import can never write or widen it — any scope
    drift on a still-granted grant re-pends the whole grant, and every re-pend (manifest drift,
    replace/import, REQUEST, TTL expiry, revoke) strips it, exactly like `autoConfirm`/`expiresAt`.
  - **Actor authenticity (load-bearing).** The acting agent is bound from the server-side
    session/tool-registration identity (threaded `RequestContext → RpcHandlerContext`), NEVER a
    request param. A parked mutation records the server-bound requester and the confirm-time
    re-gate re-checks scope against IT. The WS transport threads no identity, so a scoped grant
    FAILS CLOSED for an unauthenticated networked caller (`capability_pending`) — a client-claimed
    `actor` can never pass another agent's scope (wire-contract tested).
  - **Per-agent rate budgets.** The per-connector invoke limit gains an optional
    `perAgentInvokeRateMax`: an agent's ceiling becomes `min(connector, per-agent)`. Unset ⇒
    connector-only, byte-identical to prior behavior.
  - **Provenance chips + filter (lit).** On a board with ≥2 distinct agent authors, each widget
    header shows a compact deterministically-coloured chip (short id, full actor on hover) and a
    toolbar affordance filters/highlights one agent's widgets. The approvals widget renders each
    grant's per-agent scope. Zero schema change; single-agent boards are unchanged. New i18n keys
    added to the five complete locales.

## 1.7.0

### Minor Changes

- [#70](https://github.com/100yenadmin/boardstate/pull/70) [`39083cc`](https://github.com/100yenadmin/boardstate/commit/39083ccdd7b5d5689161b955b37234202467e42b) Thanks [@100yenadmin](https://github.com/100yenadmin)! - Trust-tier trio on the §17 capability grant + §18 pending-action spine: per-tool
  auto-confirm ([#62](https://github.com/100yenadmin/boardstate/issues/62)), grant TTLs ([#64](https://github.com/100yenadmin/boardstate/issues/64)), and async pending actions ([#63](https://github.com/100yenadmin/boardstate/issues/63)).

  - **Per-tool auto-confirm ([#62](https://github.com/100yenadmin/boardstate/issues/62), SPEC §17.2).** A grant gains an optional operator-set
    `autoConfirm?: string[]` (⊆ its granted `tools`). A non-`readOnly` tool in the set
    executes DIRECTLY on invoke — no park — audited `auto-confirmed` and broadcasting
    `dashboard.action.changed {status:"confirmed", autoConfirmed:true}`, still rate-limited.
    Operator-only (the approve verb); wiped on every re-pend (manifest drift, `replace`/import
    surface mutation, `tool_search` request, TTL expiry, revoke).
  - **Grant TTLs ([#64](https://github.com/100yenadmin/boardstate/issues/64), SPEC §17).** A grant gains an optional `expiresAt?: ISO-8601`,
    operator-set at approve time and required future-dated. After expiry the grant re-pends to
    `requested` (tools drop, `autoConfirm` clears) — swept ON READ (fail-closed at every
    reader incl. the confirm seam: park-then-expire-then-confirm is refused) plus a coarse host
    timer. The clock is injectable.
  - **Async pending actions ([#63](https://github.com/100yenadmin/boardstate/issues/63), SPEC §18.4).** New `asyncActions` install option (default
    false, blocking path byte-identical): an agent-invoked mutation returns a framed
    `{parked:true, id, expiresAt}` immediately and the turn ends. Settlements are delivered via
    a new `onActionSettled(record, result)` engine hook; `@boardstate/agent` adds an opt-in
    `createActionSettlementWake` that enqueues ONE follow-up turn per settlement (framed
    untrusted, no recursive cascade).
  - **Approvals widget ([#62](https://github.com/100yenadmin/boardstate/issues/62)/[#64](https://github.com/100yenadmin/boardstate/issues/64)).** Per-tool auto-confirm toggles + a TTL field on capability
    rows, a live "expires in" countdown, and renew/revoke on granted-grant management rows.

## 1.2.0

### Minor Changes

- [#51](https://github.com/100yenadmin/boardstate/pull/51) [`b05c7cd`](https://github.com/100yenadmin/boardstate/commit/b05c7cd5c50d10b83374bad0dde92c128cd00470) Thanks [@100yenadmin](https://github.com/100yenadmin)! - feat(schema): SPEC §17 v2 tool grants + all M5 schema surface (one schema train, M5b-1)

  The single S5-1 schema train — all M5 (Operational Workspace) schema surface rides
  one release so later sprints consume a released schema. Fully additive: boards using
  none of the new surface validate + normalize byte-identically (regression-tested).

  - **Tool grants (SPEC §17 v2):** `DashboardCapabilityGrant` gains `tools?: string[]`
    (namespaced `connector:tool` ids, shape-validated — NOT against
    `DATA_READ_RPC_ALLOWLIST`) and `toolsHash?`. `methods`/`streams`/`tools` are
    optional-in / always-array-out.
  - **Pending-action record:** `PendingActionRecord` type + `validatePendingAction`
    shape guard for the [#41](https://github.com/100yenadmin/boardstate/issues/41) engine (type + validation only).
  - **`builtin:action-button`** kind + props validator `{connector, tool, args?, label?}`.
  - **action-form `mode:"tool"`:** `mode`/`connector`/`tool`/`argsFrom` extend the
    fixed key-set; prompt mode stays the default and byte-identical.
  - **`source:"mcp"` binding:** `{source:"mcp", connector, tool, args?}` (shape only;
    host resolution is [#45](https://github.com/100yenadmin/boardstate/issues/45)).
  - **`dashboard.connector.list`** added to `DATA_READ_RPC_ALLOWLIST` (broker status read).
  - **WIDGET_CATALOG:** `action-button` entry + action-form tool-mode example (honesty-gate valid).

### Patch Changes

- [#53](https://github.com/100yenadmin/boardstate/pull/53) [`a0feba7`](https://github.com/100yenadmin/boardstate/commit/a0feba7dc3939c577387c0509aa3fb1ba710e477) Thanks [@100yenadmin](https://github.com/100yenadmin)! - M5 trust layer (M5b-2 + M5b-3, epic [#37](https://github.com/100yenadmin/boardstate/issues/37)): the grant lifecycle for external MCP tools
  and the server-enforced pending-action engine — closes [#40](https://github.com/100yenadmin/boardstate/issues/40) and [#41](https://github.com/100yenadmin/boardstate/issues/41).

  **Grant lifecycle + both-direction anti-rug-pull (SPEC §17.1, [#40](https://github.com/100yenadmin/boardstate/issues/40))**

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

  **Pending-action engine (SPEC §18, [#41](https://github.com/100yenadmin/boardstate/issues/41))**

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
  train ([#39](https://github.com/100yenadmin/boardstate/issues/39)) left implementation-pending markers.

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
