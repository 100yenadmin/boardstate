# @boardstate/server

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
