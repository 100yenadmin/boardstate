---
"@boardstate/core": minor
"@boardstate/host": minor
"@boardstate/lit": minor
---

The `builtin:approvals` widget now surfaces data-source CAPABILITY requests (SPEC
§17) alongside pending widget approvals — one operator queue for both. A
`requested` connector grant renders a "Data source" row with what it would reach
("3 reads + 1 stream" or the connector's description); Approve grants it, Deny
revokes, through the operator-only `dashboard.capability.approve` path.

- `@boardstate/core`: `buildApprovalsSource(workspace, resolveWidget,
  resolveCapability)` combines both classes; `PendingApprovalItem` gains
  `kind: "capability"` + a `detail` line.
- `@boardstate/host`: `approveCapability(state, transport, { name, decision })`.
- `@boardstate/lit`: the view wires the combined source; the approvals renderer
  shows the capability badge + detail.

Completes M4b's operator UI: any board with an approvals widget is the grant
console.
