# Boardstate Specification — v0.2 (draft)

> **Your dashboard is data. Any AI can build it; any human can edit it.**

Boardstate is a protocol and runtime for **agent-composable dashboards**: the entire dashboard — tabs, widgets, layout, data bindings, and the custom-widget registry — is one validated JSON document (the _board state_). Every author (an AI agent via tools, a human via UI drag/drop, a script via CLI/RPC) mutates it through the same guarded control plane. Agent-authored widgets run inside a sandbox strict enough to make foreign code safe _by construction_, behind an explicit operator approval gate.

This document specifies: the workspace document (§3), the control-plane RPC protocol (§4–5), data bindings (§6), the widget bridge protocol (§7), the capability & approval model (§8), widget-asset serving (§9), widget state (§10), and the normative security invariants (§11).

The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as in RFC 2119.

## 1. Design model

- **One store, N faces.** All mutations funnel through a single validated store. There is no privileged path: agents, humans, and scripts use the same methods with the same validation. Human drag/drop parity is a protocol requirement, not a UI nicety.
- **Two-tier capability ladder.** _Builtin_ widgets are first-party, trusted, full-capability renderers. _Custom_ widgets are foreign (agent/user-authored) code: sandboxed, capability-gated, approval-gated. Write-back (§10) upgrades both tiers from views to stateful apps.
- **Layout as data.** Because the board state is a document, it is diffable, undoable, exportable, importable, templatable, and time-travelable. The document is the API.

## 2. Conformance

A **host** is conformant if it (a) persists workspace documents that validate under §3, (b) exposes the control-plane methods of §4 with the exact parameter and response shapes, (c) emits the change notification of §5, and (d) upholds every invariant in §11. The reference conformance suite (`@boardstate/conformance`) MUST pass against the host's transport. The protocol method namespace is `dashboard.*` by design — "dashboard" is the domain noun; Boardstate is the implementation brand. The reference implementation also ships as an OpenClaw plugin, making OpenClaw the first conformant host.

## 3. The workspace document (schema v1)

Top level (unknown keys MUST be rejected):

| Field              | Type                          | Constraints                                            |
| ------------------ | ----------------------------- | ------------------------------------------------------ |
| `schemaVersion`    | `1`                           | only 1; hosts MUST reject other versions               |
| `workspaceVersion` | integer ≥ 0                   | monotonic; bumped on every committed mutation          |
| `tabs`             | `Tab[]`                       | ≤ 32                                                   |
| `widgetsRegistry`  | `Record<name, RegistryEntry>` | name: `^[A-Za-z0-9._-]{1,64}$`, excluding `.` and `..` |
| `prefs`            | `{ tabOrder: string[] }`      | each entry a known tab slug, no duplicates             |

**Tab:** `slug` (`^[a-z0-9-]{1,40}$`, unique), `title` (1–80), `icon?` (≤ 40), `hidden` (bool), `createdBy` (_Actor_), `widgets` (≤ 24), `layout?` (`"grid"` \| `"full"` — full-bleed tab apps), `visibility?` (`"shared"` \| `"private"`), `owner?` (operator identity; REQUIRED when private).

**Widget:** `id` (`^[A-Za-z0-9_-]{1,48}$`, globally unique), `kind` (§3.1), `title?` (≤ 80), `grid` (`x` 0–11, `y` 0–499, `w` 1–12, `h` 1–20; `x+w` ≤ 12), `collapsed` (bool), `hidden` (bool), `bindings?` (`Record<bindingId, Binding>` — §6), `props?` (JSON-serializable), `ephemeral?` (`{ expiresAt: ISO-8601 }` — the store sweeps expired ephemeral widgets on read; clearing the marker "pins" the widget).

**Actor:** `"user"` \| `"system"` \| `"agent:<sanitized-id>"` — provenance for every tab/widget, the basis of per-agent grouping and blame.

**RegistryEntry:** `{ status: "pending" | "approved" | "rejected", createdBy: Actor, approvedBy?, approvedAt? }`. See §8 for the lifecycle rules.

### 3.1 Widget kinds

`builtin:<name>` where `<name>` ∈ the host's builtin registry (reference set: `stat-card`, `markdown`, `table`, `iframe-embed`, `sessions`, `usage`, `cron`, `instances`, `activity`, `chart`, `notes`, `action-form`, `preview`, `agent-status`, `approvals`, `chat`), or `custom:<name>` where `<name>` is a `widgetsRegistry` key. A UI MUST NOT instantiate a `custom:` widget whose registry status is not `approved` (§8, §11-I3).

### 3.2 Size limits

Serialized document ≤ 256 KB. `static` binding values ≤ 8 KB. Per-widget state blobs ≤ 64 KB (§10). Undo history: 20 entries (ring).

## 4. The control-plane protocol

Transport-agnostic request/response methods. Parameters are validated against an **allowed-keys whitelist per method** — unknown keys MUST be rejected with an error (this catches contract drift at the wire; see §12 for why). Unless noted, mutating methods take an optional `actor` and respond `{ doc, workspaceVersion }` with the post-mutation document; read methods never mutate.

| Method                        | Params (allowed keys)                                                      | Notes                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `dashboard.workspace.get`     | —                                                                          | → `{ doc, workspaceVersion }`                                                                    |
| `dashboard.workspace.replace` | `doc`, `actor?`                                                            | full-document replace; MUST run full §3 validation; agent-facing surfaces MUST sanitize per §8.2 |
| `dashboard.workspace.undo`    | `actor?`                                                                   | pops the undo ring                                                                               |
| `dashboard.tab.create`        | `title`, `slug?`, `icon?`, `actor?`                                        | slug generated when absent                                                                       |
| `dashboard.tab.update`        | `slug`, `patch{title,icon,hidden}`, `actor?`                               |                                                                                                  |
| `dashboard.tab.delete`        | `slug`, `actor?`                                                           |                                                                                                  |
| `dashboard.tab.reorder`       | `order[]`, `actor?`                                                        |                                                                                                  |
| `dashboard.widget.add`        | `tab`, `widget{...}`, `actor?`                                             |                                                                                                  |
| `dashboard.widget.update`     | `tab`, `id`, `patch{title,grid,collapsed,hidden,bindings,props}`, `actor?` | **the** widget-mutation shape: `{ tab, id, patch }`                                              |
| `dashboard.widget.move`       | `tab`, `id`, `grid` XOR `toTab`, `actor?`                                  |                                                                                                  |
| `dashboard.widget.remove`     | `tab`, `id`, `actor?`                                                      |                                                                                                  |
| `dashboard.widget.setLayout`  | `tab`, `layout[{id,grid}]`, `actor?`                                       | batch geometry                                                                                   |
| `dashboard.widget.approve`    | `name`, `decision: "approved"\|"rejected"`, `actor?`                       | the ONLY path to `approved` (§8)                                                                 |
| `dashboard.data.read`         | `binding`                                                                  | → `{ data }`; resolves `file`/server-side bindings (§6)                                          |

**Extensions** (shipped by the reference implementation; normative tables finalized with the v0.1 port): `dashboard.widget.state.set` / `state.get` (per-widget state with optional `expectedVersion` optimistic concurrency — §10); `dashboard.workspace.history.list` / `history.get` (time-travel over the undo ring); gallery install and presence surfaces. Hosts MAY omit extensions; the conformance suite marks them optional.

**Multi-operator visibility:** a host serving multiple operator identities MUST filter every doc-serializing response through the private-tab visibility rule (§11-I6) — a `private` tab is absent from the wire payload (including `prefs.tabOrder`) for every caller except its `owner`. Fail closed: an unidentified caller sees no private tabs.

## 5. Change notification

After every committed mutation the host MUST broadcast exactly one event — reference name `boardstate.changed` — with payload `{ workspaceVersion, changedTabSlug?, actor }`. Clients use `workspaceVersion` to gate refetches; UIs MAY apply optimistic mutations and MUST reconcile on the broadcast (reference behavior: revert only if no fresher document has arrived).

## 6. Data bindings

A binding declares _what data a widget sees_; resolution is performed by the trusted side (host UI parent or server), **never by widget code** (§7, §11-I1).

| Source     | Shape                                       | Resolved by                      | Rules                                                                                                                                                                                                                                    |
| ---------- | ------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rpc`      | `{ source:"rpc", method }`                  | client                           | `method` MUST be in the host's read-methods allowlist (reference: 17 read-only methods); no caller-controlled `params` may be persisted in a binding. The server MUST reject resolving `rpc` bindings itself (`binding_client_resolved`) |
| `file`     | `{ source:"file", path, pointer? }`         | server via `dashboard.data.read` | path jailed under the host's dashboard data dir; ≤ 1 MB; JSON pointer applied server-side                                                                                                                                                |
| `static`   | `{ source:"static", value }`                | either                           | ≤ 8 KB                                                                                                                                                                                                                                   |
| `stream`   | `{ source:"stream", event, pointer? }`      | client                           | `event` MUST be in the host's event allowlist; no arbitrary subscription                                                                                                                                                                 |
| `computed` | `{ source:"computed", op, inputs[], arg? }` | client                           | `op` from a fixed enumerated set — **no expression evaluation, no eval**                                                                                                                                                                 |

The rpc/event allowlists are host policy; the reference lists are normative for the reference host and a ceiling, not a floor — hosts SHOULD start narrower. Client and server copies of an allowlist MUST be drift-guarded by a test that imports both.

## 7. The widget bridge protocol (v1)

Communication between the trusted parent (host page) and a sandboxed custom widget is exclusively `postMessage`. Every message carries `{ v: 1 }`; unknown or malformed inbound messages are **silently dropped** (counted, never answered).

**Child → parent:** `dashboard:ready` (handshake) · `dashboard:getData { requestId, bindingId }` · `dashboard:getTheme { requestId }` · `dashboard:sendPrompt { requestId, text }` (non-empty).

**Parent → child:** `dashboard:data { requestId, bindingId, data }` · `dashboard:push { bindingId, data }` (unsolicited update; no requestId) · `dashboard:theme { requestId, tokens }` · `dashboard:error { requestId?, code, message }`.

**Error codes:** `binding_denied` · `capability_denied` · `rate_limited` · `prompt_declined` · `timeout` · `resolve_failed` (+ reserved `malformed`).

**Gating rules (normative):**

1. `getData` — `bindingId` MUST be declared in the widget's own manifest, else `binding_denied`; the parent then re-checks the binding against the host allowlist (defense in depth) before resolving; resolution timeout (reference 10 s) → `timeout`.
2. `sendPrompt` — requires the manifest capability `prompt:send` else `capability_denied`; then a rate limit (reference: 1 in-flight + 10 per rolling 60 s, keyed by **widget name at module scope** so an iframe remount cannot reset it); then a **per-invocation operator confirmation**; a decline sends `prompt_declined`. All prompt dispatch MUST route through the host's single confirm+rate gate — no widget-reachable secondary path (§11-I5).
3. **Identity, not origin:** the child's origin is opaque (`null`); implementations MUST NOT compare origin strings. The parent MUST accept messages only from the exact window it created (`event.source === iframe.contentWindow`) and MUST post to the child with `targetOrigin: "*"` carrying only data the widget is entitled to.

## 8. Capability model & approval lifecycle

### 8.1 Manifest

A custom widget ships `widget.json`: name (§3 charset), entry (`index.html`), declared `bindingIds`, and capabilities from the enumerated set (`data:read`, `prompt:send`, `state:persist`). Capabilities are a _ceiling_ — each is further gated at use time (§7).

### 8.2 The approval invariant

A custom widget's registry status is `pending` at every entry point: scaffolding, agent `workspace.replace` (sanitizer forces new entries to pending), and **import** (sanitizer additionally strips `approvedBy`/`approvedAt` and forces pending unconditionally — an imported document claiming approval is still pending). The ONLY transition to `approved` is an explicit operator decision via `dashboard.widget.approve`. Hosts MUST NOT auto-approve under any circumstance. Pending/rejected widgets: no iframe client-side, 404 server-side (§9).

This MUST be enforced **at the control plane, not only at the caller** — a `dashboard.workspace.replace` MUST NOT elevate any custom widget to `approved` that was not already `approved` in the current document (it is forced back to `pending`, with `approvedBy`/`approvedAt` stripped), even if the caller supplies a document that claims otherwise. Otherwise an agent granted write scope could bypass the gate by hitting the raw replace method instead of the sanitizing agent tool. (The reference implementation enforces this inside the store's write lock; the conformance suite pins it.)

## 9. Widget-asset serving

Assets for a custom widget MAY be served without ambient credentials (sandboxed frames carry none), if and only if ALL of the following hold: static files only, GET/HEAD only; the widget name validates against §3 charset (rejecting `.`/`..`); the resolved path passes containment **twice** — lexical resolve-prefix check, then `realpath` on both sides re-checked (defeats symlink escape); the registry status is `approved`; and **every** failure mode returns 404 (never 403 — the route must not leak existence). Every response MUST carry (reference values, normative for the reference host):

```
Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; frame-ancestors 'self'
X-Content-Type-Options: nosniff · Referrer-Policy: no-referrer · Cache-Control: no-store
```

`connect-src 'none'` makes "widgets have no network" structural rather than conventional.

## 10. Widget state (write-back)

Persistent per-widget state upgrades widgets from views to apps. `dashboard.widget.state.set { widgetId, blob, expectedVersion? }` — blob ≤ 64 KB, jailed under the widget's own state key (a widget can never address another widget's state), `expectedVersion` mismatch MUST reject (optimistic concurrency). Bridge access requires the `state:persist` capability. State records carry `{ version, updatedAt, blob }`.

## 11. Security invariants (normative)

| #   | Invariant                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Widget code never fetches: bindings are resolved by the trusted side only; CSP `connect-src 'none'` enforces it structurally                                                                   |
| I2  | Custom widgets run with opaque origin: `sandbox="allow-scripts"` and never `allow-same-origin`; message trust is by window identity, never origin string                                       |
| I3  | No approval, no execution: pending/rejected ⇒ no iframe client-side AND 404 server-side; approval is an explicit operator act; imports/scaffolds/agent-replaces always land pending            |
| I4  | Serving is jailed: charset + double containment + static-only + uniform 404                                                                                                                    |
| I5  | Prompt dispatch is single-gated: every widget-originated prompt crosses one shared operator-confirm + rate-limit gate; interpolated templates are single-pass (inserted text never re-scanned) |
| I6  | Private tabs are enforced server-side: filtered from every serialized response for non-owners; fail-closed for unidentified callers                                                            |
| I7  | Pub/sub is tab-scoped: the parent broker never crosses tab boundaries; capability-gated, size- and rate-capped                                                                                 |
| I8  | The document is the sole state authority: one validated store, serialized writes, atomic persistence, bounded undo                                                                             |

## 12. Why the conformance suite exists

The reference implementation's UI and server were originally unit-tested against _mocks of each other_, and three P1 contract-drift bugs shipped green: file bindings sent the wrong shape, every widget mutation sent the wrong shape, and initial load read the wrong response envelope — an empty dashboard. `@boardstate/conformance` productizes that lesson: it drives a **real client against a real host over the host's own transport** and pins the exact wire shapes (`{ doc }` envelope; `{ tab, id, patch }` mutations, rejecting legacy `{ slug, widgetId }`; `{ binding }` data reads; import→pending; single `boardstate.changed` per mutation). Run it against your transport before shipping a host.

## 13. Provenance

Extracted from the modular-dashboard system built for OpenClaw (roadmap: openclaw/openclaw#101136) by its authors. Source branches (fork `100yenadmin/openclaw`): base `up/pr3-custom-widgets @ aa54dc0c2b`; features `write-back @ 4c5b119770` · `preview @ b23a3b2362` · `charts+sdk @ d0b8615fd0` · `sdk-docs @ b00611bf83` · `ops-widgets @ 6624e5b986` · `notes @ f6a71c1f48` · `binding-kinds @ 1717e4a5ee` · `pubsub @ 5430328c6e` · `living-answers @ e68b455066` · `time-travel @ 876d5a397d` · `apps-layer @ 0da800fcb6` · `control-hub @ 1d92fb6236` · `distribution @ c71f97aa77`.

## 14. Chat & agent-turn protocol (v0.2)

The chat surface makes "an AI drives the board while you watch" a protocol feature, not
an app feature. The agent loop (whatever runs the model) is a **client of the control
plane** — it composes through the same `dashboard.*` methods as every other face; this
section only standardizes how a turn is _started_ and how its progress is _streamed_.

### 14.1 Methods

- `chat.send { sessionKey, message }` — start an agent turn. Returns `{ turnId }`
  immediately; progress arrives as events (§14.2). Hosts without an agent loop MUST
  reject with a descriptive error (clients surface it — never a silent failure).
- `chat.history.get { sessionKey }` — returns `{ events }`, the retained event ring for
  the session (host-defined cap, reference: 200) so a chat view survives remount.
- `chat.abort { sessionKey, turnId }` — request cancellation; the host MUST emit
  `abort` then `turn-end { stopReason: "aborted" }` even if provider I/O misbehaves.

### 14.2 The event stream (`AgentStreamEvent`)

Events broadcast in-process as `boardstate.chat.event` (one event name; payload is the
typed event). Streamed content uses **start → delta\* → end triads keyed by stable ids**
so concurrent blocks never collide. Every event carries `sessionKey`; all but `error`
carry `turnId`.

| Type              | Fields (beyond sessionKey/turnId)   | Notes                                               |
| ----------------- | ----------------------------------- | --------------------------------------------------- |
| `turn-start`      | —                                   | first event of a turn                               |
| `text-start`      | `id`                                | opens an assistant text block                       |
| `text-delta`      | `id, delta`                         | append-only                                         |
| `text-end`        | `id`                                | closes the block                                    |
| `tool-call-start` | `callId, name`                      | name = a `dashboard.*` method                       |
| `tool-call-delta` | `callId, argsTextDelta`             | RAW partial text; UI affordance only, never parse   |
| `tool-call-ready` | `callId, name, args`                | args parsed; execution begins                       |
| `tool-result`     | `callId, ok, result?, error?`       | `error: { code, message, retryable }`               |
| `usage`           | `inputTokens, outputTokens`         | cumulative within the turn                          |
| `turn-end`        | `stopReason`                        | `end · length · aborted · max-iterations · refusal` |
| `abort`           | —                                   | user stop; distinct from `error`                    |
| `error`           | `turnId?, code, message, retryable` | terminal when followed by `turn-end`                |

Ordering invariants (conformance-pinned): `turn-start` precedes all; every `*-start`
has a matching `*-end` (or the turn ends `aborted`); `tool-call-ready` precedes its
`tool-result`; exactly one `turn-end` per turn, always last.

### 14.3 HTTP mirroring (SSE)

HTTP hosts mirror the bus at `GET /chat/stream?sessionKey=…` as `text/event-stream`:
named `event:` types (one per event type), `id: <turnId>:<seq>` on every event, and a
`: heartbeat` comment at least every 30s. **v0.2 streams are non-resumable**: clients
MUST NOT rely on `Last-Event-ID` replay — on disconnect, tear down, re-fetch history
via `chat.history.get`, and show a reconnected state.

### 14.4 Agent-loop requirements (for conforming agent hosts)

A host that implements `chat.send` with a real model loop MUST: execute store-mutating
tool calls **serially** (read-only calls MAY run in parallel); enforce a tool-iteration
ceiling and a per-turn token ceiling, ending the turn `max-iterations`/`length` when
hit; report provider failures as `error` events with honest `retryable` classification;
and ensure an aborted turn cannot leave a tool call half-applied (in-flight calls
complete or are never started — the store's serialized writes make this cheap).

### 14.5 Design provenance

§14 was designed against 2026 prior art (AI SDK UI-message streams, Anthropic/OpenAI
native streaming, MCP Apps): the triads, raw tool-arg deltas, and non-resumable v0.2
SSE are deliberate, recorded choices — rationale in `docs/ROADMAP.md`.

## 15. Agent self-review (informative)

The self-building loop's first rung: the board can be **reviewed by the same agent
that composed it**, through the same control plane. Hosts MAY implement any of it;
nothing in this section is load-bearing for conformance.

- **The read model** is a pure design lint over the workspace document —
  `reviewWorkspace(doc)` in `@boardstate/core` — returning ranked findings
  `{ code, severity: "info" | "warn", tab?, widgetId?, message, suggestion }`. The
  twelve v1 rule codes are exported as `WORKSPACE_REVIEW_RULES` (density, empty tab,
  numbers-not-leading, untitled chart, source-named tabs, missing context note,
  leftover ephemerals, oversized widget, duplicate titles, sparse chart, unbounded
  table, orphaned registry entries). Rules are total functions: a weird-but-valid
  document yields fewer findings, never an error.
- **The agent's mirror** is a readOnly tool, `dashboard_design_review`, wrapping that
  lint over the live store (`@boardstate/server`, browser-safe core tool set). It
  returns findings + counts — advisory, never errors; the agent fixes what it agrees
  with through the ordinary `dashboard_*` mutation tools, under the same provenance
  and approval gates as any other write (§8, §11-I3).
- **The loop policy** lives client-side, in the agent runner — e.g.
  `createAgentChatAgent({ selfReview: "once" })` appends ONE bounded review pass after
  a turn that mutated the board, within the same ceilings (§14.4), and keeps the wire
  a single §14 turn: one `turn-start`, one terminal `turn-end`. Unbounded
  review-until-clean loops are deliberately out of scope for v1.

Findings are conventions, not contract: rule codes MAY grow; consumers MUST ignore
codes they do not recognize.

## 16. Host connectors (normative-lite)

How a host wires real data into `rpc` and `stream` bindings. The ALLOWLISTS are the
normative core (they already govern §3's binding validation); the rest records the
contract hosts implement.

- **Reads**: a host MAY register any `DATA_READ_RPC_ALLOWLIST` method with read scope;
  an `rpc` binding resolves it per widget refresh. Hosts MUST NOT expose data-read
  methods outside the allowlist to binding resolution.
- **Streams**: a host MAY broadcast on any `STREAM_EVENT_ALLOWLIST` channel; a
  `stream` binding applies its JSON pointer to each payload. Hosts MUST NOT carry
  connector data on `boardstate.changed` — that channel signals document changes and
  clients respond by refetching the document.
- **Networked hosts** (§ the out-of-process seam): a transport that mirrors host
  broadcasts MUST forward every `STREAM_EVENT_ALLOWLIST` channel it accepts
  subscriptions for — a networked view receives exactly what an in-process view can
  subscribe to. Requests arriving without an operator identity are unidentified:
  private-tab filtering (§11-I6) applies fail-closed.
- Extending either allowlist is a SCHEMA change, never a host-runtime option.

The reference implementation is `installConnector` (`@boardstate/server`, browser-safe)
plus the runnable sidecar in `examples/connector-sidecar/` — see `docs/connectors.md`.

---

_Spec version 0.2-draft · 2026-07-10 · License: MIT_
