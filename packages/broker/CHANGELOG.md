# @boardstate/broker

## 0.2.1

### Patch Changes

- Updated dependencies [[`52a3d3c`](https://github.com/100yenadmin/boardstate/commit/52a3d3c74d4bca8211c701ca844a8617f9d767e7)]:
  - @boardstate/server@1.3.0

## 0.2.0

### Minor Changes

- [#50](https://github.com/100yenadmin/boardstate/pull/50) [`e96a33f`](https://github.com/100yenadmin/boardstate/commit/e96a33fd2b3f06f6c610650a27074d4561154428) Thanks [@100yenadmin](https://github.com/100yenadmin)! - New package `@boardstate/broker` — the MCP CLIENT manager (M5a-1, epic [#37](https://github.com/100yenadmin/boardstate/issues/37)). It connects
  outward to the external MCP servers an operator declares in a `boardstate.connectors.json`
  config, discovers their tools into a namespaced `ToolManifest`, and calls them behind a
  narrow API the host/server layers consume.

  - **Config is operator-authored only**: `loadConnectorsConfig(path)` + a programmatic
    `new McpBroker(config)`. A connector name not in the config is inert. `env` values are
    process-env var NAMES (references), never literal secrets — validated up front and never
    echoed into errors or logs.
  - **Transports**: `StdioClientTransport` for local servers, `StreamableHTTPClientTransport`
    with SSE fallback for remotes. Lazy connect on first use, warm/pooled clients, capped
    exponential-backoff reconnect, clean close.
  - **`listTools()` → `ToolManifest`**: `connector:tool` ids AND provider-safe
    `connector__tool` names (both inside a 64-char budget, collisions fail loud), input
    schemas, `readOnlyHint` honored (absent ⇒ treated as a mutation — fail-safe), and a
    stable manifest hash over sorted (id + canonical input-schema) pairs — the anti-rug-pull
    snapshot the grant lifecycle (M5b-2) pins to.
  - **`callTool(id, args, { timeout })`**: resolves the client, strips the namespace,
    enforces a hard timeout, and normalizes `isError: true` results into a typed
    `BrokerToolError`.

  Depends only on `@modelcontextprotocol/sdk` and `@boardstate/server` (types only). Ships
  an in-repo fake MCP server fixture (stdio child + in-process HTTP) so CI needs no network.

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

- Updated dependencies [[`c895241`](https://github.com/100yenadmin/boardstate/commit/c8952418b9fd2b64a2a014927476502899d07938), [`a0feba7`](https://github.com/100yenadmin/boardstate/commit/a0feba7dc3939c577387c0509aa3fb1ba710e477)]:
  - @boardstate/server@1.2.0
