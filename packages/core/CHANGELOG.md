# @boardstate/core

## 1.6.0

### Minor Changes

- [#69](https://github.com/100yenadmin/boardstate/pull/69) [`eae965d`](https://github.com/100yenadmin/boardstate/commit/eae965df70f36c65e7d12008bfa097a70901b1de) Thanks [@100yenadmin](https://github.com/100yenadmin)! - History list rows now carry a compact per-save change summary. `listHistory`
  computes it at read time by diffing each ring snapshot against its predecessor
  (counts of added/removed/moved/retitled widgets + tab changes, plus the dominant
  actor), so `DashboardHistoryEntry` gains an optional `summary` and the undo ring
  on disk is unchanged (no bloat, size caps untouched). Exposes
  `summarizeWorkspaceDiff` / `DashboardHistorySummary` from the history-diff module.
  The transport-backed `loadHistoryList` (host) carries the summary across the wire.

## 1.5.0

### Minor Changes

- [#65](https://github.com/100yenadmin/boardstate/pull/65) [`85e129c`](https://github.com/100yenadmin/boardstate/commit/85e129c9a4dbb4b553e22802d7428c371c38b6ed) Thanks [@100yenadmin](https://github.com/100yenadmin)! - feat(chart): distinct sparkline model + opt-in detail mode ([#10](https://github.com/100yenadmin/boardstate/issues/10), [#4](https://github.com/100yenadmin/boardstate/issues/4))

  `mapChart` now resolves two new props onto `ChartModel`: `detail` (labeled axes,
  gridlines, and value tooltips) and `label` (a sparkline's trailing value badge). Both
  opt in only on a strict `true`, so every existing chart doc maps to the same model as
  before — `detail`/`label` default off. The catalog's `builtin:chart` entry documents the
  two props and ships copy-pasteable `sparkline` and `detail` examples (both honesty-gated).

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

### Patch Changes

- Updated dependencies [[`b05c7cd`](https://github.com/100yenadmin/boardstate/commit/b05c7cd5c50d10b83374bad0dde92c128cd00470), [`a0feba7`](https://github.com/100yenadmin/boardstate/commit/a0feba7dc3939c577387c0509aa3fb1ba710e477)]:
  - @boardstate/schema@1.2.0

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

### Patch Changes

- Updated dependencies [[`af1df09`](https://github.com/100yenadmin/boardstate/commit/af1df09e17e36d597243a0fe78121e6cf5c9cf17)]:
  - @boardstate/schema@1.0.0

## 0.4.0

### Minor Changes

- [#20](https://github.com/100yenadmin/boardstate/pull/20) [`66cd58e`](https://github.com/100yenadmin/boardstate/commit/66cd58e952a50be721e1351d5540077ba29698bb) Thanks [@100yenadmin](https://github.com/100yenadmin)! - Networked transport + a browser bundle — the two gaps that blocked out-of-process
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
    Networked reads carry no operator identity, so private-tab filtering is fail-closed
    (an unidentified operator sees no private tab). The frame codec **refuses an unmasked
    client frame (RFC 6455 §5.1) and a frame whose declared length exceeds the 1 MB message
    cap** — the latter before buffering toward it, so a hostile length claim cannot grow the
    inbound buffer unbounded (a memory-DoS guard).
  - **`@boardstate/lit`** adds a self-contained browser bundle at `@boardstate/lit/browser`
    (`import "@boardstate/lit/browser"` defines the custom elements with no bundler or
    import map). `boardstate-mcp --serve` now renders the real `<boardstate-view>` when the
    bundle is built (falling back to the JSON view otherwise).

- [`ccf0f89`](https://github.com/100yenadmin/boardstate/commit/ccf0f89e651473611de9f2793ae063e4d6fa578e) - The builtin-widget catalog — first-try correctness for agent-built boards. The
  first real external agent run (Hermes + GLM) guessed wrong widget prop/binding
  shapes and mounted empty widgets; the catalog prevents it instead of the review
  loop catching it after the fact.

  - **`@boardstate/core`**: `WIDGET_CATALOG` / `DATA_SOURCE_WIDGET_KINDS` — per
    builtin kind, the exact binding keys + value shapes, props, and a
    copy-pasteable example; every example is validated against the workspace
    schema in a unit test, so a copied example always mounts non-empty.
  - **`@boardstate/server`**: `dashboard_widget_catalog`, a readOnly tool in the
    browser-safe core tool set (flows through `@boardstate/mcp` as
    `boardstate_widget_catalog`). Optional `kind` filter.
  - **`@boardstate/agent`**: the system prompt now points the model at the
    catalog before its first `widget_add`, and the composition guide's
    table/markdown/action-form lines are corrected (a table binds `rows`, a
    markdown binds `content` — data goes in `bindings.<key>`, never in props).

  Two seam bugs fixed along the way (@boardstate/server):
  - `dashboard_widget_update` (the agent tool) threw `unexpected param: tab` on
    EVERY call — the addressing fields were never stripped before the patch
    reader, so agents could never patch a widget. Fixed + regression-tested.
  - Widget `props` sent as a JSON-encoded STRING (a routine model double-encode)
    sailed through validation and silently stripped every renderer's
    format/type/labels. The tool and RPC seams now coerce an unambiguous
    stringified object back to the object and reject other non-object props
    loudly.

## 0.3.2

### Patch Changes

- [`f2f23ae`](https://github.com/100yenadmin/boardstate/commit/f2f23ae1bb849eb357839debc0c675ed05484c1b) - Mac-style lift-and-carry drag: the dragged card now follows the pointer 1:1
  (raw pixel deltas from `DashboardDragState.pointerDx/Dy`), lifted with a shadow
  and a grabbing cursor, while the landing cell shows as a QUIET neutral
  placeholder — red stays reserved for an invalid (colliding) drop. Previously
  the card never moved and the snapped accent/red ghost rectangles were the only
  drag feedback, which read as "colored bars" instead of direct manipulation.
  Resize keeps the ghost preview. Also hardened: a pointer that vanishes between
  pointerdown and capture can no longer kill the drag wiring.

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

## 0.2.1

### Patch Changes

- [`49655b2`](https://github.com/100yenadmin/boardstate/commit/49655b2d9826cba377dbc1afb971b57e1fae1084) - Enable npm provenance attestations declaratively (`publishConfig.provenance`):
  the 0.2.0 train's `NPM_CONFIG_PROVENANCE` env wiring was silently ignored by the
  publish path, so those tarballs carry registry signatures but no Sigstore
  attestation. The declarative flag fails loudly if OIDC is unavailable instead of
  skipping. No code changes.
- Updated dependencies [[`49655b2`](https://github.com/100yenadmin/boardstate/commit/49655b2d9826cba377dbc1afb971b57e1fae1084)]:
  - @boardstate/schema@0.2.1

## 0.2.0

### Minor Changes

- [`052ee22`](https://github.com/100yenadmin/boardstate/commit/052ee223495829bc6769f0c1cff9e441f26631ca) - `reviewWorkspace(doc)` — a pure 12-rule design lint powering agent self-review (M4a).

### Patch Changes

- [`f86e99a`](https://github.com/100yenadmin/boardstate/commit/f86e99a8223638af4e89d24a4e1d14dfe0251f9a) - Fix `normalizeWorkspace` silently stripping `stream` and `computed` bindings: the
  defensive client read-model normalizer only recognized `rpc`/`file`/`static`
  sources, so a stream-bound widget lost its binding on every client load and
  rendered "—" forever (the raw RPC response carried it fine). `DashboardBinding`
  now also carries the `event`, `op`, `inputs`, and `arg` fields.

## 0.1.0

### Minor Changes

- [`57888e4`](https://github.com/100yenadmin/boardstate/commit/57888e488469478876d5ebb18707456c75cb5397) - Initial release: the Boardstate protocol and runtime, extracted from the modular-dashboard system built for OpenClaw. Workspace document schema + validators, headless store with storage/transport adapters, the `dashboard.*` control plane with agent tools and jailed widget serving, the framework-free sandbox host with the postMessage bridge, the Lit reference view with 15 builtin widgets, React wrappers, an MCP server, and the transport conformance suite.

### Patch Changes

- Updated dependencies [[`57888e4`](https://github.com/100yenadmin/boardstate/commit/57888e488469478876d5ebb18707456c75cb5397), [`d045057`](https://github.com/100yenadmin/boardstate/commit/d045057a371d2073b32e0bc7f47cfdc56bccdc54)]:
  - @boardstate/schema@0.1.0
