---
"@boardstate/schema": minor
"@boardstate/core": minor
"@boardstate/server": minor
"@boardstate/lit": minor
---

Multi-agent workspaces (#59, SPEC §17.3): several agents sharing one board, distinguishable
and separately governed.

- **Per-agent grant scoping (schema + engine).** A capability grant gains an optional
  operator-set `agents?: string[]` — the ACTOR dimension of the AND-gate. Absent ⇒ all agents
  (back-compat, zero migration); present ⇒ only those agent actors pass, at BOTH tool-set
  assembly (the agent-tool adapter surfaces a scoped grant only to a bound, listed agent —
  covering the direct `readOnly` path) and invoke/read time (`dashboard.action.invoke` /
  `dashboard.connector.read` fail-safe recheck). Operator-set ONLY (the approve verb);
  `tool_search` REQUEST / `workspace.replace` / import can never write or widen it — any scope
  drift on a still-granted grant re-pends the whole grant, and every re-pend (manifest drift,
  replace/import, REQUEST, TTL expiry, revoke) strips it, exactly like `autoConfirm`/`expiresAt`.
- **Actor authenticity (load-bearing).** The acting agent is bound from the server-side
  session/tool-registration identity (threaded `RequestContext → RpcHandlerContext`), NEVER a
  request param. A parked mutation records the server-bound requester and the confirm-time
  re-gate re-checks scope against IT. The WS transport threads no identity, so a scoped grant
  FAILS CLOSED for an unauthenticated networked caller (`capability_pending`) — a client-claimed
  `actor` can never pass another agent's scope (wire-contract tested).
- **Per-agent rate budgets.** The per-connector invoke limit gains an optional
  `perAgentInvokeRateMax`: an agent's ceiling becomes `min(connector, per-agent)`. Unset ⇒
  connector-only, byte-identical to prior behavior.
- **Provenance chips + filter (lit).** On a board with ≥2 distinct agent authors, each widget
  header shows a compact deterministically-coloured chip (short id, full actor on hover) and a
  toolbar affordance filters/highlights one agent's widgets. The approvals widget renders each
  grant's per-agent scope. Zero schema change; single-agent boards are unchanged. New i18n keys
  added to the five complete locales.
