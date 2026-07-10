---
"@boardstate/core": minor
"@boardstate/host": minor
"@boardstate/lit": minor
---

feat(lit,core,host): action-button widget + mcp read bindings (M5d-1 + M5d-2)

Surfaces the connector broker's capabilities to the board — humans get the same
operational hands the agent has, under the same gates. Additive: boards using none of
the new surface behave identically.

**M5d-1 — action affordances (#44)**

- **`builtin:action-button`** renderer + `mapActionButton` transform: one click →
  `dashboard.action.invoke {connector, tool, args}`. The full lifecycle renders INLINE
  — idle → running → (readOnly) result | (mutation) pending "waiting for operator" →
  confirmed/denied/expired — driven by the live `dashboard.action.changed` stream. The
  untrusted tool RESULT is rendered INERT (epic invariant #1). Over a networked
  transport the confirm affordance renders disabled-with-reason; the local operator
  (`operator: true`) may confirm/deny inline. The engine re-checks the grant at invoke
  time, so a revoked-between-validate-and-invoke tool rejects loudly.
- **action-form `mode:"tool"`**: `buildActionToolArgs` maps coerced field values →
  tool args via `argsFrom` (no template interpolation), submitting through the same
  invoke seam.
- New `BuiltinActionsSeam` on the builtin context; `operator` property on
  `<boardstate-view>` gating the confirm affordance (mirrors the server's
  `allowOperatorMethods` default-false).

**M5d-2 — mcp read bindings (#45)**

- Host `resolveBinding` gains an `mcp` branch: a `source:"mcp"` read binding resolves
  through the broker's readOnly action path. readOnly-ONLY, invoke-time fail-safe — a
  parked mutation (`{pending:true}`) is rejected, never auto-fired; an ungranted tool
  surfaces `capability_pending` and recovers on the next refresh after a grant. The
  `mcp` binding's fields survive the real load path (`normalizeWorkspace` regression).
