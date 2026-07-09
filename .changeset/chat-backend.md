---
"@boardstate/server": minor
"@boardstate/conformance": minor
"@boardstate/mcp": patch
"@boardstate/react": patch
---

Add the chat & agent-turn backend surface (SPEC §14).

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
