# @boardstate/conformance

## 0.1.0

### Minor Changes

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

- Updated dependencies [[`8661565`](https://github.com/100yenadmin/boardstate/commit/86615650debbf62288ce40f3f5c8132a7d353fe0), [`21c0ed1`](https://github.com/100yenadmin/boardstate/commit/21c0ed107d8b1b890bd4278345427d79f36b03bb), [`57888e4`](https://github.com/100yenadmin/boardstate/commit/57888e488469478876d5ebb18707456c75cb5397), [`d045057`](https://github.com/100yenadmin/boardstate/commit/d045057a371d2073b32e0bc7f47cfdc56bccdc54)]:
  - @boardstate/server@0.1.0
  - @boardstate/schema@0.1.0
  - @boardstate/core@0.1.0
