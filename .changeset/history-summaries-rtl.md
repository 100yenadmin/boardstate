---
"@boardstate/core": minor
---

History list rows now carry a compact per-save change summary. `listHistory`
computes it at read time by diffing each ring snapshot against its predecessor
(counts of added/removed/moved/retitled widgets + tab changes, plus the dominant
actor), so `DashboardHistoryEntry` gains an optional `summary` and the undo ring
on disk is unchanged (no bloat, size caps untouched). Exposes
`summarizeWorkspaceDiff` / `DashboardHistorySummary` from the history-diff module.
The transport-backed `loadHistoryList` (host) carries the summary across the wire.
