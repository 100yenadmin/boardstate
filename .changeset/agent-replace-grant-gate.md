---
"@boardstate/server": patch
---

Security: the `dashboard_workspace_replace` agent tool now passes the structural
replace gate (`reconcileReplaceApproval`), so an agent can no longer self-grant a
capability by writing `status: "granted"` into `capabilitiesRegistry`. Only
`dashboard.capability.approve` (operator-only) grants. The RPC replace path was
already gated; this closes the agent-tool path.
