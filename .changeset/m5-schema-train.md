---
"@boardstate/schema": minor
"@boardstate/core": minor
---

feat(schema): SPEC §17 v2 tool grants + all M5 schema surface (one schema train, M5b-1)

The single S5-1 schema train — all M5 (Operational Workspace) schema surface rides
one release so later sprints consume a released schema. Fully additive: boards using
none of the new surface validate + normalize byte-identically (regression-tested).

- **Tool grants (SPEC §17 v2):** `DashboardCapabilityGrant` gains `tools?: string[]`
  (namespaced `connector:tool` ids, shape-validated — NOT against
  `DATA_READ_RPC_ALLOWLIST`) and `toolsHash?`. `methods`/`streams`/`tools` are
  optional-in / always-array-out.
- **Pending-action record:** `PendingActionRecord` type + `validatePendingAction`
  shape guard for the #41 engine (type + validation only).
- **`builtin:action-button`** kind + props validator `{connector, tool, args?, label?}`.
- **action-form `mode:"tool"`:** `mode`/`connector`/`tool`/`argsFrom` extend the
  fixed key-set; prompt mode stays the default and byte-identical.
- **`source:"mcp"` binding:** `{source:"mcp", connector, tool, args?}` (shape only;
  host resolution is #45).
- **`dashboard.connector.list`** added to `DATA_READ_RPC_ALLOWLIST` (broker status read).
- **WIDGET_CATALOG:** `action-button` entry + action-form tool-mode example (honesty-gate valid).
