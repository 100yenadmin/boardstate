# @boardstate/server

## 1.6.0

### Patch Changes

- Updated dependencies [[`eae965d`](https://github.com/100yenadmin/boardstate/commit/eae965df70f36c65e7d12008bfa097a70901b1de)]:
  - @boardstate/core@1.6.0

## 1.5.0

### Patch Changes

- Updated dependencies [[`85e129c`](https://github.com/100yenadmin/boardstate/commit/85e129c9a4dbb4b553e22802d7428c371c38b6ed)]:
  - @boardstate/core@1.5.0

## 1.4.0

### Minor Changes

- [#57](https://github.com/100yenadmin/boardstate/pull/57) [`ed04514`](https://github.com/100yenadmin/boardstate/commit/ed045143d925ba7a6479c8e969ee7e4beb0cc0f9) Thanks [@100yenadmin](https://github.com/100yenadmin)! - feat(server): one-call M5 host wiring — `installConnectorWorkspace` (M5e)

  The connector broker's server-side pieces landed as separate installers with a load-bearing
  ORDER; a Node host had to call four of them in the right sequence and thread three handles
  into `registerBoardstateRpc` + the agent tool set. `installConnectorWorkspace`
  (`@boardstate/server/node`) encodes that assembly once: it installs the pending-action
  engine FIRST (it registers `dashboard.action.invoke`), then the broker→AgentTool adapter,
  then the `boardstate_tool_search` backing, and returns the two seams the caller still owns
  explicitly — `capabilityToolsHash` (into `registerBoardstateRpc`) and `toolSearch` (into
  `createDashboardTools`). It consumes the broker through the existing narrow structural
  interfaces (`ActionBroker` + `AgentToolBroker`), no `@boardstate/broker` import, so the
  dependency arrow stays one-way. Additive: boards using no connector broker are unaffected.

## 1.3.0

### Minor Changes

- [#55](https://github.com/100yenadmin/boardstate/pull/55) [`52a3d3c`](https://github.com/100yenadmin/boardstate/commit/52a3d3c74d4bca8211c701ca844a8617f9d767e7) Thanks [@100yenadmin](https://github.com/100yenadmin)! - feat(server): broker→AgentTool adapter + `boardstate_tool_search` (M5c-1 + M5c-2)

  Granted external MCP tools now reach the agent. `createBrokerAgentTools` wraps each GRANTED
  tool as an `AgentTool` (provider-safe name, untrusted-framed description, `external: true`);
  `readOnly` tools execute directly through the broker while mutations route through the
  server-enforced pending-action engine (park → await operator confirm), returning a
  model-legible refusal on deny/timeout/expiry rather than throwing. `installBrokerAgentTools`
  wires the adapter via `host.registerTool` (grant/revoke picked up next turn).

  Adds the `boardstate_tool_search` core tool (SEARCH a connector's full catalog, bounded and
  schema-free; REQUEST tools by appending to the connector grant's `requested` set — never
  grants, re-pends a granted grant per the merged partial-grant lifecycle) with the node-side
  `createBrokerToolSearch` backing. `AgentTool` gains an optional `external` marker. SPEC §18.1
  and §18.2 document the agent surface and the request/approve loop.

### Patch Changes

- Updated dependencies [[`d2620ba`](https://github.com/100yenadmin/boardstate/commit/d2620baf243b7dfc8197ee05523aaa9cd7e2fe11)]:
  - @boardstate/core@1.3.0

## 1.2.0

### Minor Changes

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

- [`c895241`](https://github.com/100yenadmin/boardstate/commit/c8952418b9fd2b64a2a014927476502899d07938) - Security: the `dashboard_workspace_replace` agent tool now passes the structural
  replace gate (`reconcileReplaceApproval`), so an agent can no longer self-grant a
  capability by writing `status: "granted"` into `capabilitiesRegistry`. Only
  `dashboard.capability.approve` (operator-only) grants. The RPC replace path was
  already gated; this closes the agent-tool path.
- Updated dependencies [[`b05c7cd`](https://github.com/100yenadmin/boardstate/commit/b05c7cd5c50d10b83374bad0dde92c128cd00470), [`a0feba7`](https://github.com/100yenadmin/boardstate/commit/a0feba7dc3939c577387c0509aa3fb1ba710e477)]:
  - @boardstate/schema@1.2.0
  - @boardstate/core@1.2.0

## 1.1.0

### Patch Changes

- Updated dependencies [[`364898d`](https://github.com/100yenadmin/boardstate/commit/364898d99e2e653f527a37a473543b6d8c987a59)]:
  - @boardstate/core@1.1.0

## 1.0.0

### Major Changes

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
  - @boardstate/core@1.0.0

## 0.5.1

### Patch Changes

- [`51a8ef9`](https://github.com/100yenadmin/boardstate/commit/51a8ef9a1259d0a3f994e725b1ceef58f74718ad) - Security: the WS transport now refuses **operator-only methods**
  (`dashboard.widget.approve`) over the wire by default. The networked transport
  threads no operator identity, so an operator ACTION arriving over the wire has
  no authenticated operator behind it — yet `attachWsTransport` previously
  forwarded EVERY method (scope is metadata, never a dispatch gate), so opening a
  read-only networked viewer silently also exposed the widget-approval gate to any
  client that passed `verifyClient` (a confused-deputy footgun). Approve is now
  blocked before dispatch unless the host opts in with `allowOperatorMethods:
true` (for when it authenticates the operator itself in `verifyClient`).
  Composing/driving the board over the wire is unchanged. Found while framing the
  M4b capability broker (approve-unreachable-by-networked-requesters is its
  prerequisite).

## 0.5.0

### Minor Changes

- [`f147568`](https://github.com/100yenadmin/boardstate/commit/f147568a98a325357729f3b8e090c106d7114356) - The host connector contract (SPEC §16, M4c) — wiring REAL data into live boards.

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

## 0.3.0

### Minor Changes

- [`ff6fcf1`](https://github.com/100yenadmin/boardstate/commit/ff6fcf104979f2470c655ef213635b94a4bc0411) - `dashboard_design_review` — a readOnly agent tool in the browser-safe core set
  wrapping `reviewWorkspace` from `@boardstate/core`: returns ranked design-lint
  findings (`{ code, severity, tab, widgetId, message, suggestion }`) plus counts,
  the agent's mirror for reviewing and improving its own board (SPEC §15, M4a).

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

### Minor Changes

- [`b21993e`](https://github.com/100yenadmin/boardstate/commit/b21993ea67d274297ccb8d1f17f3ef1596bceecf) - Add `createDashboardCoreTools` to the browser-safe root entry: the full
  `dashboard_*` mutation tool set minus the node-only tools (widget scaffolding to
  disk, file-binding data reads), needing only a store + broadcast. Previously the
  entire tool factory lived behind `@boardstate/server/node`, so a browser host
  wiring `createAgentChatAgent({ host, provider })` handed the model ZERO tools —
  it could chat but never touch the board. `createDashboardTools` on the node
  entry is unchanged (same names, same behavior; scaffold/data-read now appended
  after `dashboard_undo`).

### Patch Changes

- Updated dependencies [[`f86e99a`](https://github.com/100yenadmin/boardstate/commit/f86e99a8223638af4e89d24a4e1d14dfe0251f9a), [`052ee22`](https://github.com/100yenadmin/boardstate/commit/052ee223495829bc6769f0c1cff9e441f26631ca)]:
  - @boardstate/core@0.2.0

## 0.1.0

### Minor Changes

- [`8661565`](https://github.com/100yenadmin/boardstate/commit/86615650debbf62288ce40f3f5c8132a7d353fe0) - Ship a runnable **`boardstate`** CLI binary. `@boardstate/server` now declares a
  `boardstate` bin (`dist/bin.js`) that wires the full `dashboard` command tree
  (`tabs` / `widgets` / `layout` / `widget-scaffold`) over a local state dir —
  `$BOARDSTATE_STATE_DIR`, else `~/.boardstate`, created on demand.

  It also adds the top-level `boardstate tab add <name>` shortcut that the empty-state
  onboarding copy advertises; it's an alias for `dashboard tabs create --title`, driving
  the same `dashboard.tab.create` control-plane method (no privileged path).

  ```sh
  npx --package @boardstate/server boardstate tab add sales
  ```

- [`21c0ed1`](https://github.com/100yenadmin/boardstate/commit/21c0ed107d8b1b890bd4278345427d79f36b03bb) - Add the chat & agent-turn backend surface (SPEC §14).

  `@boardstate/server` gains browser-safe chat plumbing: `createChatSessions` (a
  per-session `AgentStreamEvent` ring buffer + live `CHAT_EVENT` re-broadcast + per-turn
  `AbortController` registry, default cap 200) and `registerChatRpc`. `registerBoardstateRpc`
  now accepts `chat` (a `ChatSessions`) and `chatAgent` (a `ChatAgent` loop): when both are
  given it registers `chat.send` (allocates a `turnId`, responds immediately, then runs the
  agent async); `chat.history.get` and `chat.abort` register whenever `chat` is present. A
  host with no agent loop leaves `chat.send` unregistered so the wire rejects it (§14.1).
  `chat.abort` is idempotent — it fires the turn's `AbortController` and emits `abort` +
  `turn-end{ stopReason: "aborted" }`, and the event sink guarantees exactly one `turn-end`
  (always last). `AgentTool` gains an optional `readOnly` flag (tagged across the dashboard
  tools), and a shared `agentToolToJsonSchema` util is exported (now used by `@boardstate/mcp`
  in place of its private strip).

  `@boardstate/conformance` adds opt-in §14 assertions (`chat: true`): turn-start first,
  matched text triads, `tool-call-ready` before its `tool-result`, exactly one terminal
  `turn-end`, and mid-turn `chat.abort` semantics.

  `@boardstate/react` re-exports `AgentStreamEvent` for convenience.

- [`57888e4`](https://github.com/100yenadmin/boardstate/commit/57888e488469478876d5ebb18707456c75cb5397) - Initial release: the Boardstate protocol and runtime, extracted from the modular-dashboard system built for OpenClaw. Workspace document schema + validators, headless store with storage/transport adapters, the `dashboard.*` control plane with agent tools and jailed widget serving, the framework-free sandbox host with the postMessage bridge, the Lit reference view with 15 builtin widgets, React wrappers, an MCP server, and the transport conformance suite.

### Patch Changes

- Updated dependencies [[`57888e4`](https://github.com/100yenadmin/boardstate/commit/57888e488469478876d5ebb18707456c75cb5397), [`d045057`](https://github.com/100yenadmin/boardstate/commit/d045057a371d2073b32e0bc7f47cfdc56bccdc54)]:
  - @boardstate/schema@0.1.0
  - @boardstate/core@0.1.0
