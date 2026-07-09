---
"@boardstate/agent": minor
---

`createAgentChatAgent({ selfReview: "once" })` — the self-building loop's first
rung (SPEC §15, M4a). After a turn that mutated the board, the runner appends ONE
bounded follow-up pass asking the model to call `dashboard_design_review`, fix the
findings it agrees with, and summarize — same token/iteration ceilings, and the
wire stays a single §14 turn (one `turn-start`, one terminal `turn-end`). Default
`"off"`.
