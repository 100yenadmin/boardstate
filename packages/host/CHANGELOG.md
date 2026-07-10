# @boardstate/host

## 1.3.0

### Minor Changes

- [#54](https://github.com/100yenadmin/boardstate/pull/54) [`d2620ba`](https://github.com/100yenadmin/boardstate/commit/d2620baf243b7dfc8197ee05523aaa9cd7e2fe11) Thanks [@100yenadmin](https://github.com/100yenadmin)! - feat(lit,core,host): action-button widget + mcp read bindings (M5d-1 + M5d-2)

  Surfaces the connector broker's capabilities to the board — humans get the same
  operational hands the agent has, under the same gates. Additive: boards using none of
  the new surface behave identically.

  **M5d-1 — action affordances ([#44](https://github.com/100yenadmin/boardstate/issues/44))**

  - **`builtin:action-button`** renderer + `mapActionButton` transform: one click →
    `dashboard.action.invoke {connector, tool, args}`. The full lifecycle renders INLINE
    — idle → running → (readOnly) result | (mutation) pending "waiting for operator" →
    confirmed/denied/expired — driven by the live `dashboard.action.changed` stream. The
    untrusted tool RESULT is rendered INERT (epic invariant [#1](https://github.com/100yenadmin/boardstate/issues/1)). Over a networked
    transport the confirm affordance renders disabled-with-reason; the local operator
    (`operator: true`) may confirm/deny inline. The engine re-checks the grant at invoke
    time, so a revoked-between-validate-and-invoke tool rejects loudly.
  - **action-form `mode:"tool"`**: `buildActionToolArgs` maps coerced field values →
    tool args via `argsFrom` (no template interpolation), submitting through the same
    invoke seam.
  - New `BuiltinActionsSeam` on the builtin context; `operator` property on
    `<boardstate-view>` gating the confirm affordance (mirrors the server's
    `allowOperatorMethods` default-false).

  **M5d-2 — mcp read bindings ([#45](https://github.com/100yenadmin/boardstate/issues/45))**

  - Host `resolveBinding` gains an `mcp` branch: a `source:"mcp"` read binding resolves
    through the broker's readOnly action path. readOnly-ONLY, invoke-time fail-safe — a
    parked mutation (`{pending:true}`) is rejected, never auto-fired; an ungranted tool
    surfaces `capability_pending` and recovers on the next refresh after a grant. The
    `mcp` binding's fields survive the real load path (`normalizeWorkspace` regression).

### Patch Changes

- Updated dependencies [[`d2620ba`](https://github.com/100yenadmin/boardstate/commit/d2620baf243b7dfc8197ee05523aaa9cd7e2fe11)]:
  - @boardstate/core@1.3.0

## 1.2.0

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

- Updated dependencies [[`b05c7cd`](https://github.com/100yenadmin/boardstate/commit/b05c7cd5c50d10b83374bad0dde92c128cd00470), [`a0feba7`](https://github.com/100yenadmin/boardstate/commit/a0feba7dc3939c577387c0509aa3fb1ba710e477)]:
  - @boardstate/schema@1.2.0
  - @boardstate/core@1.2.0

## 1.1.0

### Minor Changes

- [`364898d`](https://github.com/100yenadmin/boardstate/commit/364898d99e2e653f527a37a473543b6d8c987a59) - The `builtin:approvals` widget now surfaces data-source CAPABILITY requests (SPEC
  §17) alongside pending widget approvals — one operator queue for both. A
  `requested` connector grant renders a "Data source" row with what it would reach
  ("3 reads + 1 stream" or the connector's description); Approve grants it, Deny
  revokes, through the operator-only `dashboard.capability.approve` path.

  - `@boardstate/core`: `buildApprovalsSource(workspace, resolveWidget,
resolveCapability)` combines both classes; `PendingApprovalItem` gains
    `kind: "capability"` + a `detail` line.
  - `@boardstate/host`: `approveCapability(state, transport, { name, decision })`.
  - `@boardstate/lit`: the view wires the combined source; the approvals renderer
    shows the capability badge + detail.

  Completes M4b's operator UI: any board with an approvals widget is the grant
  console.

### Patch Changes

- Updated dependencies [[`364898d`](https://github.com/100yenadmin/boardstate/commit/364898d99e2e653f527a37a473543b6d8c987a59)]:
  - @boardstate/core@1.1.0

## 1.0.0

### Patch Changes

- Updated dependencies [[`af1df09`](https://github.com/100yenadmin/boardstate/commit/af1df09e17e36d597243a0fe78121e6cf5c9cf17)]:
  - @boardstate/schema@1.0.0
  - @boardstate/core@1.0.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`66cd58e`](https://github.com/100yenadmin/boardstate/commit/66cd58e952a50be721e1351d5540077ba29698bb), [`ccf0f89`](https://github.com/100yenadmin/boardstate/commit/ccf0f89e651473611de9f2793ae063e4d6fa578e)]:
  - @boardstate/core@0.4.0

## 0.3.2

### Patch Changes

- Updated dependencies [[`f2f23ae`](https://github.com/100yenadmin/boardstate/commit/f2f23ae1bb849eb357839debc0c675ed05484c1b)]:
  - @boardstate/core@0.3.2

## 0.3.1

### Patch Changes

- [`9636400`](https://github.com/100yenadmin/boardstate/commit/963640033e7acdec2407dced868a4b979b2db07f) - Publish flow: `pnpm -r publish --provenance` + `changeset tag` — the third and
  loud-failing provenance attempt. `changeset publish` silently dropped provenance
  through BOTH `NPM_CONFIG_PROVENANCE` and `publishConfig.provenance`; the explicit
  `--provenance` flag errors when OIDC is unavailable instead of skipping, so this
  train either carries Sigstore attestations or the release run tells us exactly
  why not. No code changes.
- Updated dependencies [[`9636400`](https://github.com/100yenadmin/boardstate/commit/963640033e7acdec2407dced868a4b979b2db07f)]:
  - @boardstate/schema@0.3.1
  - @boardstate/core@0.3.1

## 0.2.1

### Patch Changes

- [`49655b2`](https://github.com/100yenadmin/boardstate/commit/49655b2d9826cba377dbc1afb971b57e1fae1084) - Enable npm provenance attestations declaratively (`publishConfig.provenance`):
  the 0.2.0 train's `NPM_CONFIG_PROVENANCE` env wiring was silently ignored by the
  publish path, so those tarballs carry registry signatures but no Sigstore
  attestation. The declarative flag fails loudly if OIDC is unavailable instead of
  skipping. No code changes.
- Updated dependencies [[`49655b2`](https://github.com/100yenadmin/boardstate/commit/49655b2d9826cba377dbc1afb971b57e1fae1084)]:
  - @boardstate/schema@0.2.1
  - @boardstate/core@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [[`f86e99a`](https://github.com/100yenadmin/boardstate/commit/f86e99a8223638af4e89d24a4e1d14dfe0251f9a), [`052ee22`](https://github.com/100yenadmin/boardstate/commit/052ee223495829bc6769f0c1cff9e441f26631ca)]:
  - @boardstate/core@0.2.0

## 0.1.0

### Minor Changes

- [`57888e4`](https://github.com/100yenadmin/boardstate/commit/57888e488469478876d5ebb18707456c75cb5397) - Initial release: the Boardstate protocol and runtime, extracted from the modular-dashboard system built for OpenClaw. Workspace document schema + validators, headless store with storage/transport adapters, the `dashboard.*` control plane with agent tools and jailed widget serving, the framework-free sandbox host with the postMessage bridge, the Lit reference view with 15 builtin widgets, React wrappers, an MCP server, and the transport conformance suite.

### Patch Changes

- Updated dependencies [[`57888e4`](https://github.com/100yenadmin/boardstate/commit/57888e488469478876d5ebb18707456c75cb5397), [`d045057`](https://github.com/100yenadmin/boardstate/commit/d045057a371d2073b32e0bc7f47cfdc56bccdc54)]:
  - @boardstate/schema@0.1.0
  - @boardstate/core@0.1.0
