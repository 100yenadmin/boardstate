# @boardstate/schema

## 0.1.0

### Minor Changes

- [`57888e4`](https://github.com/100yenadmin/boardstate/commit/57888e488469478876d5ebb18707456c75cb5397) - Initial release: the Boardstate protocol and runtime, extracted from the modular-dashboard system built for OpenClaw. Workspace document schema + validators, headless store with storage/transport adapters, the `dashboard.*` control plane with agent tools and jailed widget serving, the framework-free sandbox host with the postMessage bridge, the Lit reference view with 15 builtin widgets, React wrappers, an MCP server, and the transport conformance suite.

- [`d045057`](https://github.com/100yenadmin/boardstate/commit/d045057a371d2073b32e0bc7f47cfdc56bccdc54) - SPEC v0.2: §14 "Chat & agent-turn protocol" — `chat.send`/`chat.history.get`/`chat.abort`,
  the `AgentStreamEvent` stream contract (start→delta→end triads keyed by stable ids,
  raw tool-arg deltas, distinct abort semantics), `boardstate.chat.event` bus name, SSE
  mirroring rules (named events, per-event ids, heartbeats, explicitly non-resumable in
  v0.2), and normative agent-loop requirements (serial writes/parallel reads, iteration
  and token ceilings, honest retryable error classification).
