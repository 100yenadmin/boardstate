---
"@boardstate/server": minor
---

`dashboard_design_review` — a readOnly agent tool in the browser-safe core set
wrapping `reviewWorkspace` from `@boardstate/core`: returns ranked design-lint
findings (`{ code, severity, tab, widgetId, message, suggestion }`) plus counts,
the agent's mirror for reviewing and improving its own board (SPEC §15, M4a).
