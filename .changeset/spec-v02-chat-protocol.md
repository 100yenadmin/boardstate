---
"@boardstate/schema": minor
---

SPEC v0.2: §14 "Chat & agent-turn protocol" — `chat.send`/`chat.history.get`/`chat.abort`,
the `AgentStreamEvent` stream contract (start→delta→end triads keyed by stable ids,
raw tool-arg deltas, distinct abort semantics), `boardstate.chat.event` bus name, SSE
mirroring rules (named events, per-event ids, heartbeats, explicitly non-resumable in
v0.2), and normative agent-loop requirements (serial writes/parallel reads, iteration
and token ceilings, honest retryable error classification).
