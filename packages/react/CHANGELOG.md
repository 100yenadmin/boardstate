# @boardstate/react

## 0.1.5

### Patch Changes

- Updated dependencies [[`66cd58e`](https://github.com/100yenadmin/boardstate/commit/66cd58e952a50be721e1351d5540077ba29698bb), [`ccf0f89`](https://github.com/100yenadmin/boardstate/commit/ccf0f89e651473611de9f2793ae063e4d6fa578e)]:
  - @boardstate/core@0.4.0
  - @boardstate/lit@0.2.0
  - @boardstate/host@0.4.0

## 0.1.4

### Patch Changes

- Updated dependencies [[`f2f23ae`](https://github.com/100yenadmin/boardstate/commit/f2f23ae1bb849eb357839debc0c675ed05484c1b)]:
  - @boardstate/lit@0.1.4
  - @boardstate/core@0.3.2
  - @boardstate/host@0.3.2

## 0.1.3

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
  - @boardstate/host@0.3.1
  - @boardstate/lit@0.1.3

## 0.1.2

### Patch Changes

- [`49655b2`](https://github.com/100yenadmin/boardstate/commit/49655b2d9826cba377dbc1afb971b57e1fae1084) - Enable npm provenance attestations declaratively (`publishConfig.provenance`):
  the 0.2.0 train's `NPM_CONFIG_PROVENANCE` env wiring was silently ignored by the
  publish path, so those tarballs carry registry signatures but no Sigstore
  attestation. The declarative flag fails loudly if OIDC is unavailable instead of
  skipping. No code changes.
- Updated dependencies [[`49655b2`](https://github.com/100yenadmin/boardstate/commit/49655b2d9826cba377dbc1afb971b57e1fae1084)]:
  - @boardstate/schema@0.2.1
  - @boardstate/core@0.2.1
  - @boardstate/host@0.2.1
  - @boardstate/lit@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [[`f86e99a`](https://github.com/100yenadmin/boardstate/commit/f86e99a8223638af4e89d24a4e1d14dfe0251f9a), [`052ee22`](https://github.com/100yenadmin/boardstate/commit/052ee223495829bc6769f0c1cff9e441f26631ca)]:
  - @boardstate/core@0.2.0
  - @boardstate/host@0.2.0
  - @boardstate/lit@0.1.1

## 0.1.0

### Minor Changes

- [`57888e4`](https://github.com/100yenadmin/boardstate/commit/57888e488469478876d5ebb18707456c75cb5397) - Initial release: the Boardstate protocol and runtime, extracted from the modular-dashboard system built for OpenClaw. Workspace document schema + validators, headless store with storage/transport adapters, the `dashboard.*` control plane with agent tools and jailed widget serving, the framework-free sandbox host with the postMessage bridge, the Lit reference view with 15 builtin widgets, React wrappers, an MCP server, and the transport conformance suite.

### Patch Changes

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

- Updated dependencies [[`21c0ed1`](https://github.com/100yenadmin/boardstate/commit/21c0ed107d8b1b890bd4278345427d79f36b03bb), [`878a149`](https://github.com/100yenadmin/boardstate/commit/878a149f4c9b5fa7091b7468a07acd2d746de562), [`ee374ab`](https://github.com/100yenadmin/boardstate/commit/ee374abe15da7942c08ff81d218c6e242e4810b8), [`57888e4`](https://github.com/100yenadmin/boardstate/commit/57888e488469478876d5ebb18707456c75cb5397), [`8661565`](https://github.com/100yenadmin/boardstate/commit/86615650debbf62288ce40f3f5c8132a7d353fe0), [`22d1a87`](https://github.com/100yenadmin/boardstate/commit/22d1a87cdbeb196675259666872d6adb586d5af4), [`d045057`](https://github.com/100yenadmin/boardstate/commit/d045057a371d2073b32e0bc7f47cfdc56bccdc54)]:
  - @boardstate/lit@0.1.0
  - @boardstate/schema@0.1.0
  - @boardstate/core@0.1.0
  - @boardstate/host@0.1.0
