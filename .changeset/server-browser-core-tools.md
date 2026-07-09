---
"@boardstate/server": minor
---

Add `createDashboardCoreTools` to the browser-safe root entry: the full
`dashboard_*` mutation tool set minus the node-only tools (widget scaffolding to
disk, file-binding data reads), needing only a store + broadcast. Previously the
entire tool factory lived behind `@boardstate/server/node`, so a browser host
wiring `createAgentChatAgent({ host, provider })` handed the model ZERO tools —
it could chat but never touch the board. `createDashboardTools` on the node
entry is unchanged (same names, same behavior; scaffold/data-read now appended
after `dashboard_undo`).
