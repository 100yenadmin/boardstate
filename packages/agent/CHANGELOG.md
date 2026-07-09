# @boardstate/agent

## 0.1.0

### Minor Changes

- [`f01f02d`](https://github.com/100yenadmin/boardstate/commit/f01f02d8a1f15ae8425a4a8b794e808734d6b56d) - Add **`@boardstate/agent`** (M2) — the provider loop that turns any LLM into a
  dashboard-building agent, a client of the control plane rather than anything baked into
  core. Ships `runAgentTurn` (the streaming loop: forwards provider deltas as
  `AgentStreamEvent`s per SPEC §14, runs read-only tools in parallel and mutating tools
  serially, enforces per-turn token + tool-iteration ceilings, and retries transient
  provider failures with exponential backoff + jitter), `createAgentChatAgent` (the
  `chat.send` adapter with in-memory per-session history and truncation-first context
  management), the `ProviderAdapter` interface with `anthropicAdapter` (Messages API) and
  `openAICompatAdapter` (the GLM/z.ai · OpenAI · Together · Ollama path, accumulating tool
  calls by callId so Ollama's `index:0` parallel-call quirk can't merge them), and
  `buildSystemPrompt` + a registerable `dashboard_composition_guide` tool distilled from
  `docs/composition-patterns.md`. Browser-safe main entry, zero `node:*` imports; keys are
  passed in by the host, never logged or written to the workspace document.

### Patch Changes

- Updated dependencies [[`b21993e`](https://github.com/100yenadmin/boardstate/commit/b21993ea67d274297ccb8d1f17f3ef1596bceecf)]:
  - @boardstate/server@0.2.0
