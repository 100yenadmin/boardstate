---
"@boardstate/lit": minor
---

Add **`builtin:chat`** — the 16th builtin widget: the chat FACE of the control
plane (SPEC §14). It drives the `chat.*` methods through a new injected `ctx.chat`
seam (`send` / `abort` / `history` / `subscribe`, all bound to one `sessionKey`) and
renders the `AgentStreamEvent` stream — start → delta\* → end text triads as
sanitized markdown, consecutive tool calls collapsed into one group chip
("🔧 3 actions · ✓✓✗") with an expandable friendly-name log, a Stop button while a
turn is live, an inline approval card when the agent scaffolds a widget mid-turn,
and sticky-bottom autoscroll with a "Jump to latest" pill. It knows nothing about
providers — the seam is the whole coupling.

The render model is a pure, heavily-tested reducer (`reduceChatEvents`) that folds
the raw event stream into ordered turns and defends the §14 ordering invariants
(orphaned deltas, out-of-order ready/result, duplicate `turn-end`, abort mid-text)
without ever throwing.
