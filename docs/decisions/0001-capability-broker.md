# ADR 0001 — Capability broker: approval-gated data-source grants (M4b)

- **Status:** Accepted (design). Implementation gated on the prerequisite below.
- **Date:** 2026-07-10
- **Decides:** How an AI agent acquires a NEW data-source capability in-band, and how a
  human authorizes it, without inverting Boardstate's "safe by construction" trust story.
- **Deciders:** owner-delegated to the orchestrator; research + trade-off legwork commissioned
  (prior-art survey, options analysis), decision owned here.

## Context

Today the approval gate covers exactly one privilege: rendering agent-authored WIDGET code
(scaffold → `pending` → operator approves → sandboxed mount, SPEC §11-I3). The DATA surface
is static: the `rpc`/`stream` binding allowlists live in `@boardstate/schema`
(`DATA_READ_RPC_ALLOWLIST`, `STREAM_EVENT_ALLOWLIST`) and only a schema PR widens them. An
agent that legitimately needs a new source ("bind my Postgres", "watch this webhook") has no
in-band path.

Two ground-truth findings reframed the decision (verified in source, not just the frame):

1. **`RpcScope` is metadata, not a gate.** `host.request` (`packages/server/src/host.ts:203`)
   dispatches every handler regardless of `scope`; scope is only read for `listRpc`/parallel
   hints. There is no dispatch-level read/write enforcement.
2. **The approval act is not authenticated per-method.** `dashboard.widget.approve` takes a
   self-asserted `actor` (`rpc.ts` `readOptionalActor` → `?? "user"`) and never consults
   `operatorId`; the WS transport threads no operator identity. Approve was reachable by any
   networked client that passed `verifyClient` — a confused-deputy footgun **now fixed**
   (`OPERATOR_ONLY_METHODS` gate in `ws-transport.ts`, shipped 2026-07-10). That fix is M4b's
   load-bearing prerequisite: _approve must be unreachable by anonymous/networked requesters._

The reason no agent self-approves today is not an identity check — it's that the agent tool
catalog omits any approve tool and `reconcileReplaceApproval` (`core/store.ts`) forces any
replace-smuggled `approved` back to `pending` inside the write lock. **A capability broker
must preserve that barrier: no agent-reachable grant tool, and the sanitizer/reconcile
pattern extended to grants.**

## Decision

**Adopt option C-with-method-snapshot: an in-document `capabilitiesRegistry`, keyed by a
named connector, where each grant snapshots the concrete method/stream set it authorizes.**

- **The approval UNIT a human reads is the named connector** ("approve `postgres-metrics`:
  3 reads, 1 stream") — the only human-comprehensible unit (per-method breeds grant fatigue;
  whole-integration is too coarse), and it matches the SPEC §16 connector concept.
- **The enforced OBJECT is the snapshotted method list.** A connector→method map is host
  runtime state, not a doc object (a binding names a raw `method`), so the grant record
  carries the concrete methods captured at grant time. This keeps "audit the board's reach
  from the document alone" true, and is the honest admission that connector-scoping is a
  legible UX wrapper over method-granular enforcement.
- **Request → approve flow, mirroring widget approval:** the agent (or a connector) writes a
  `requested` grant to `capabilitiesRegistry`; the operator approves via a NEW operator-only
  RPC `dashboard.capability.approve` (never in the agent tool catalog; `OPERATOR_ONLY_METHODS`
  covers it, so it is unreachable over an unauthenticated wire); the binding resolver gates on
  `granted-methods ∪ frozen-allowlist`, **AND-ed** (a binding must be both allowlisted in the
  schema and granted) — never OR, so the grant path never becomes a second, weaker widening
  surface.
- **Import re-pends grants.** `sanitizeImportedWorkspace` (`core/distribution.ts`) already
  forces every widget registry entry to `pending` and strips `approvedBy`/`approvedAt` — an
  imported board is foreign. Grants extend the exact same coercion: an imported doc can carry
  a `requested` grant but never an active one.
- **Revocation is monotonic and re-checked at resolution.** Grants are never cached in widget
  state; the resolver re-reads the registry each resolution, so revoke breaks dependent
  widgets immediately (they render the `binding_denied` error surface). Revocation writes a
  tombstone the `undo` path honors, closing the undo-resurrection hazard
  (`core/store.ts` undo restores raw snapshots without reconcile).

## Alternatives rejected

- **A · method-granular registry (no connector unit):** identical enforcement, worse
  approval-card legibility (rule 8 of the prior-art synthesis). C is A with a human-readable
  approval unit.
- **B · host-side grants + doc-side requests:** immune to import-smuggling for free, but
  "what can this board reach" needs the host (split-brain audit) and grants don't travel with
  the board. Rejected for the audit regression.
- **E · host-countersigned in-doc grant tokens (macaroon-style):** dominates on export
  portability + forgery-resistance and is undo-immune, but adds a crypto/key-management
  surface and does not by itself close the operator-identity gap. **Deferred, not dead** —
  the right upgrade if/when boards are shared across hosts. C's method-snapshot record is
  forward-compatible with adding a signature later.
- **D · null (schema-PR-only):** the honest floor — zero new enforcement surface, provably
  closed. C must beat it by delivering in-band acquisition without weakening the 3-layer
  deny-by-default; it does, because grants AND-gate with the frozen allowlist.

## Consequences

- New doc surface (`capabilitiesRegistry`) becomes a security boundary for DATA, as the
  widget registry already is for CODE. `workspace.replace`/import sanitization and the
  reconcile-in-lock pattern must extend to it (the precedent is exact).
- SPEC §17 (normative): the registry shape, the grant lifecycle
  (`requested`/`granted`/`revoked`), the AND-gate resolver rule, the re-pend-on-import rule.
- `@boardstate/schema` doc schema gains one top-level key (`schemaVersion` stays 1; empty
  registry is the default, so existing docs are unaffected).
- The app surfaces a capability approval card alongside the widget approval card.

## Open questions carried into implementation

1. **Authenticated operator identity end-to-end** — the prerequisite is _partly_ delivered
   (operator-only methods are off the wire by default). Full M4b wants a positive
   `operatorId !== null` check on `capability.approve` and identity plumbed where an
   authenticated operator session exists. Until then, "approval authority == whoever holds a
   privileged in-process/authenticated socket," which is acceptable for the single-operator
   local host but must be explicit.
2. **Connector-name vs snapshot** is decided (snapshot), but the app's approval card should
   still _display_ the connector name + counts, which means the host provides the
   connector→method map to the UI at approval time (runtime, not from the doc).
3. **Grant expiry** — do grants live forever (TCC's sticky-grant failure) or carry a TTL that
   re-pends? Lean toward optional TTL, default none, decided at implementation.
