# @boardstate/lit

## 0.8.0

### Minor Changes

- [#70](https://github.com/100yenadmin/boardstate/pull/70) [`39083cc`](https://github.com/100yenadmin/boardstate/commit/39083ccdd7b5d5689161b955b37234202467e42b) Thanks [@100yenadmin](https://github.com/100yenadmin)! - Trust-tier trio on the §17 capability grant + §18 pending-action spine: per-tool
  auto-confirm ([#62](https://github.com/100yenadmin/boardstate/issues/62)), grant TTLs ([#64](https://github.com/100yenadmin/boardstate/issues/64)), and async pending actions ([#63](https://github.com/100yenadmin/boardstate/issues/63)).

  - **Per-tool auto-confirm ([#62](https://github.com/100yenadmin/boardstate/issues/62), SPEC §17.2).** A grant gains an optional operator-set
    `autoConfirm?: string[]` (⊆ its granted `tools`). A non-`readOnly` tool in the set
    executes DIRECTLY on invoke — no park — audited `auto-confirmed` and broadcasting
    `dashboard.action.changed {status:"confirmed", autoConfirmed:true}`, still rate-limited.
    Operator-only (the approve verb); wiped on every re-pend (manifest drift, `replace`/import
    surface mutation, `tool_search` request, TTL expiry, revoke).
  - **Grant TTLs ([#64](https://github.com/100yenadmin/boardstate/issues/64), SPEC §17).** A grant gains an optional `expiresAt?: ISO-8601`,
    operator-set at approve time and required future-dated. After expiry the grant re-pends to
    `requested` (tools drop, `autoConfirm` clears) — swept ON READ (fail-closed at every
    reader incl. the confirm seam: park-then-expire-then-confirm is refused) plus a coarse host
    timer. The clock is injectable.
  - **Async pending actions ([#63](https://github.com/100yenadmin/boardstate/issues/63), SPEC §18.4).** New `asyncActions` install option (default
    false, blocking path byte-identical): an agent-invoked mutation returns a framed
    `{parked:true, id, expiresAt}` immediately and the turn ends. Settlements are delivered via
    a new `onActionSettled(record, result)` engine hook; `@boardstate/agent` adds an opt-in
    `createActionSettlementWake` that enqueues ONE follow-up turn per settlement (framed
    untrusted, no recursive cascade).
  - **Approvals widget ([#62](https://github.com/100yenadmin/boardstate/issues/62)/[#64](https://github.com/100yenadmin/boardstate/issues/64)).** Per-tool auto-confirm toggles + a TTL field on capability
    rows, a live "expires in" countdown, and renew/revoke on granted-grant management rows.

### Patch Changes

- Updated dependencies [[`39083cc`](https://github.com/100yenadmin/boardstate/commit/39083ccdd7b5d5689161b955b37234202467e42b)]:
  - @boardstate/schema@1.7.0
  - @boardstate/core@1.7.0
  - @boardstate/host@1.7.0

## 0.7.0

### Minor Changes

- [#69](https://github.com/100yenadmin/boardstate/pull/69) [`eae965d`](https://github.com/100yenadmin/boardstate/commit/eae965df70f36c65e7d12008bfa097a70901b1de) Thanks [@100yenadmin](https://github.com/100yenadmin)! - View polish (issue [#4](https://github.com/100yenadmin/boardstate/issues/4)): the version-history snapshot preview now reads as an
  intentional layout — each cell shows a per-kind glyph (a faux sparkline for
  charts, stacked rows for tables/lists, a value bar for stat cards; no live data
  resolved) and the grid is captioned "Layout at version N". History list rows gain
  a compact change summary ("+2 · 1 moved · actor"). The widget gallery list shows a
  CSS-only scroll-shadow affordance when rows are cut off. The stylesheet's remaining
  physical left/right properties were converted to logical equivalents
  (`padding-inline`, `border-start-start-radius`, `text-align: start`, …) to harden
  RTL. New English strings are added to the default table only.

### Patch Changes

- Updated dependencies [[`eae965d`](https://github.com/100yenadmin/boardstate/commit/eae965df70f36c65e7d12008bfa097a70901b1de)]:
  - @boardstate/core@1.6.0
  - @boardstate/host@1.6.0

## 0.6.0

### Minor Changes

- [#65](https://github.com/100yenadmin/boardstate/pull/65) [`85e129c`](https://github.com/100yenadmin/boardstate/commit/85e129c9a4dbb4b553e22802d7428c371c38b6ed) Thanks [@100yenadmin](https://github.com/100yenadmin)! - feat(chart): sparkline type + optional detail mode ([#10](https://github.com/100yenadmin/boardstate/issues/10), [#4](https://github.com/100yenadmin/boardstate/issues/4))

  `builtin:chart` gains a distinct `sparkline` variant — a minimal axis-free line, delta-
  colored by its trend (up/down/flat) with an optional trailing value label, degrading to a
  single end dot at one point. A new opt-in `props.detail` layers labeled y-axis min/max
  labels, faint gridlines, and per-point value tooltips (native `<title>`, no new dependency,
  no `innerHTML`) over the line/bar/area/gauge types. Line/bar/area/gauge charts without the
  new props render byte-identically — the overlays are HTML siblings/SVG layers gated on the
  new props. Docs already using `type:"sparkline"` (previously a fallthrough that drew a
  plain line) now get the true sparkline rendering — an intended visual upgrade whose
  `dashboard-chart__spark*` classes replace the bare polyline. New CSS lives in a trailing
  `/* chart-detail */` block.

### Patch Changes

- [#66](https://github.com/100yenadmin/boardstate/pull/66) [`87df317`](https://github.com/100yenadmin/boardstate/commit/87df317861957cdaf45ab4121c07d762997b1b11) Thanks [@100yenadmin](https://github.com/100yenadmin)! - i18n(lit): complete ja-JP, zh-CN, de, es, fr locale tables ([#12](https://github.com/100yenadmin/boardstate/issues/12))

  `packages/lit/src/locales/*.ts` shipped ~34 translated core-chrome keys per
  language; every later-wave key (history, gallery, preview, agent status,
  approvals, chat, distribution, action-button) fell back to English for all 20
  locales. This locale sweep fills **ja-JP, zh-CN, de, es, and fr** to 100%
  coverage of `BoardstateStringKey` (177/177 keys each) with UI-register
  translations that match each file's existing terminology and formality —
  placeholders (`{name}`-style) preserved exactly, technical loanwords
  (gateway/sandbox/token) handled per language convention. The other 15 shipped
  locales are untouched and keep falling back to English for the new keys.

  Adds `packages/lit/src/locales.test.ts`, asserting these five locales cover
  every key in the English source table (and preserve every placeholder token),
  so a future key added to `strings.ts` without a matching translation fails
  the test loudly instead of silently falling back to English in these five
  locales.

- Updated dependencies [[`85e129c`](https://github.com/100yenadmin/boardstate/commit/85e129c9a4dbb4b553e22802d7428c371c38b6ed)]:
  - @boardstate/core@1.5.0
  - @boardstate/host@1.5.0

## 0.5.0

### Minor Changes

- [#54](https://github.com/100yenadmin/boardstate/pull/54) [`d2620ba`](https://github.com/100yenadmin/boardstate/commit/d2620baf243b7dfc8197ee05523aaa9cd7e2fe11) Thanks [@100yenadmin](https://github.com/100yenadmin)! - feat(lit,core,host): action-button widget + mcp read bindings (M5d-1 + M5d-2)

  Surfaces the connector broker's capabilities to the board — humans get the same
  operational hands the agent has, under the same gates. Additive: boards using none of
  the new surface behave identically.

  **M5d-1 — action affordances ([#44](https://github.com/100yenadmin/boardstate/issues/44))**

  - **`builtin:action-button`** renderer + `mapActionButton` transform: one click →
    `dashboard.action.invoke {connector, tool, args}`. The full lifecycle renders INLINE
    — idle → running → (readOnly) result | (mutation) pending "waiting for operator" →
    confirmed/denied/expired — driven by the live `dashboard.action.changed` stream. The
    untrusted tool RESULT is rendered INERT (epic invariant [#1](https://github.com/100yenadmin/boardstate/issues/1)). Over a networked
    transport the confirm affordance renders disabled-with-reason; the local operator
    (`operator: true`) may confirm/deny inline. The engine re-checks the grant at invoke
    time, so a revoked-between-validate-and-invoke tool rejects loudly.
  - **action-form `mode:"tool"`**: `buildActionToolArgs` maps coerced field values →
    tool args via `argsFrom` (no template interpolation), submitting through the same
    invoke seam.
  - New `BuiltinActionsSeam` on the builtin context; `operator` property on
    `<boardstate-view>` gating the confirm affordance (mirrors the server's
    `allowOperatorMethods` default-false).

  **M5d-2 — mcp read bindings ([#45](https://github.com/100yenadmin/boardstate/issues/45))**

  - Host `resolveBinding` gains an `mcp` branch: a `source:"mcp"` read binding resolves
    through the broker's readOnly action path. readOnly-ONLY, invoke-time fail-safe — a
    parked mutation (`{pending:true}`) is rejected, never auto-fired; an ungranted tool
    surfaces `capability_pending` and recovers on the next refresh after a grant. The
    `mcp` binding's fields survive the real load path (`normalizeWorkspace` regression).

### Patch Changes

- Updated dependencies [[`d2620ba`](https://github.com/100yenadmin/boardstate/commit/d2620baf243b7dfc8197ee05523aaa9cd7e2fe11)]:
  - @boardstate/core@1.3.0
  - @boardstate/host@1.3.0

## 0.4.0

### Minor Changes

- [#53](https://github.com/100yenadmin/boardstate/pull/53) [`a0feba7`](https://github.com/100yenadmin/boardstate/commit/a0feba7dc3939c577387c0509aa3fb1ba710e477) Thanks [@100yenadmin](https://github.com/100yenadmin)! - M5 trust layer (M5b-2 + M5b-3, epic [#37](https://github.com/100yenadmin/boardstate/issues/37)): the grant lifecycle for external MCP tools
  and the server-enforced pending-action engine — closes [#40](https://github.com/100yenadmin/boardstate/issues/40) and [#41](https://github.com/100yenadmin/boardstate/issues/41).

  **Grant lifecycle + both-direction anti-rug-pull (SPEC §17.1, [#40](https://github.com/100yenadmin/boardstate/issues/40))**

  - `installBrokerActions` (`@boardstate/server/node`) registers each configured connector's
    discovered tools as a `requested` tools-only grant (explicit `methods: []`/`streams: []`,
    a `tools` id snapshot, and a subset-scoped `toolsHash`), mirroring `installConnector`'s
    request-on-install. An already-`granted` grant survives a restart; real manifest drift is
    caught at invoke time.
  - Server-side anti-rug-pull: on every granted-tool call the live manifest hash is compared
    to the stored `toolsHash`; a mismatch re-pends the grant to `requested` BEFORE any call
    succeeds.
  - Agent-side anti-rug-pull: `reconcileReplaceApproval` now forces a `granted` grant back to
    `requested` on ANY `tools`/`toolsHash` mutation (not just status flips) — closing the
    red-team hole where an agent could append a tool id to a granted grant through
    `workspace.replace` or import.
  - Partial grants: `dashboard.capability.approve` gains an optional `tools` subset; the
    decision applies to the intersection with the requested set and the granted subset gets
    its OWN hash (`McpBroker.hashToolSubset`, injected as `capabilityToolsHash`).
  - Approvals console: capability rows surface their requested tool ids for per-tool selection
    (approve-all = one click); the core transform + lit renderer + strings render it.

  **Pending-action engine (SPEC §18, [#41](https://github.com/100yenadmin/boardstate/issues/41))**

  - In-memory pending-action registry. `dashboard.action.invoke` AND-gates a call (granted at
    invoke time + connector configured + hash unchanged): a `readOnly` granted tool executes
    directly; a mutation parks as a `PendingActionRecord` and returns `{ pending: true, id,
expiresAt }`. `dashboard.action.confirm`/`dashboard.action.deny` are operator-only
    (`OPERATOR_ONLY_METHODS`) — a networked client can directly execute only `readOnly` tools.
  - TTL expiry (~5 min), single-shot terminal states (a replay of a terminal id errors),
    server-side invoke rate limiting (prompt-gate discipline), an audit entry per invoke +
    decision, and lifecycle broadcasts on `dashboard.action.changed`.
  - `confirmAndExecute(id)` is exposed as the awaitable an agent-mediated call (M5c-1) blocks
    on: it resolves with the tool result on confirm and rejects on deny/expiry.

  The engine consumes the broker through the narrow structural `ActionBroker` interface —
  `@boardstate/broker` never enters `@boardstate/server` (no dependency cycle); the real
  `McpBroker` fits it structurally. SPEC §17.1/§18 normative text filled where the schema
  train ([#39](https://github.com/100yenadmin/boardstate/issues/39)) left implementation-pending markers.

### Patch Changes

- Updated dependencies [[`b05c7cd`](https://github.com/100yenadmin/boardstate/commit/b05c7cd5c50d10b83374bad0dde92c128cd00470), [`a0feba7`](https://github.com/100yenadmin/boardstate/commit/a0feba7dc3939c577387c0509aa3fb1ba710e477)]:
  - @boardstate/schema@1.2.0
  - @boardstate/core@1.2.0
  - @boardstate/host@1.2.0

## 0.3.0

### Minor Changes

- [`364898d`](https://github.com/100yenadmin/boardstate/commit/364898d99e2e653f527a37a473543b6d8c987a59) - The `builtin:approvals` widget now surfaces data-source CAPABILITY requests (SPEC
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

### Patch Changes

- Updated dependencies [[`364898d`](https://github.com/100yenadmin/boardstate/commit/364898d99e2e653f527a37a473543b6d8c987a59)]:
  - @boardstate/core@1.1.0
  - @boardstate/host@1.1.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`af1df09`](https://github.com/100yenadmin/boardstate/commit/af1df09e17e36d597243a0fe78121e6cf5c9cf17)]:
  - @boardstate/schema@1.0.0
  - @boardstate/core@1.0.0
  - @boardstate/host@1.0.0

## 0.2.0

### Minor Changes

- [#20](https://github.com/100yenadmin/boardstate/pull/20) [`66cd58e`](https://github.com/100yenadmin/boardstate/commit/66cd58e952a50be721e1351d5540077ba29698bb) Thanks [@100yenadmin](https://github.com/100yenadmin)! - Networked transport + a browser bundle — the two gaps that blocked out-of-process
  hosts (e.g. an in-browser dashboard driven by a Node sidecar).

  - **`@boardstate/core`** adds `createWsTransport(url)` — a `Transport` over a
    browser-native WebSocket (JSON `{id,method,params}` / `{id,result|error}` /
    `{event,payload}` frames). Zero-dependency and bundler-safe (`globalThis.WebSocket`);
    v1 has no auto-reconnect (a dropped socket rejects every request cleanly).
  - **`@boardstate/server`** adds `attachWsTransport(server, host)` (from
    `@boardstate/server/node`) — an opt-in, hand-rolled RFC 6455 endpoint that dispatches
    request frames to the same in-process host surface and mirrors host broadcasts to
    connected clients. Changes no default; owns only the `upgrade` handshake on its path.
    Pinned by `@boardstate/conformance` running the full suite over a real WS pair.
    Networked reads carry no operator identity, so private-tab filtering is fail-closed
    (an unidentified operator sees no private tab). The frame codec **refuses an unmasked
    client frame (RFC 6455 §5.1) and a frame whose declared length exceeds the 1 MB message
    cap** — the latter before buffering toward it, so a hostile length claim cannot grow the
    inbound buffer unbounded (a memory-DoS guard).
  - **`@boardstate/lit`** adds a self-contained browser bundle at `@boardstate/lit/browser`
    (`import "@boardstate/lit/browser"` defines the custom elements with no bundler or
    import map). `boardstate-mcp --serve` now renders the real `<boardstate-view>` when the
    bundle is built (falling back to the JSON view otherwise).

### Patch Changes

- Updated dependencies [[`66cd58e`](https://github.com/100yenadmin/boardstate/commit/66cd58e952a50be721e1351d5540077ba29698bb), [`ccf0f89`](https://github.com/100yenadmin/boardstate/commit/ccf0f89e651473611de9f2793ae063e4d6fa578e)]:
  - @boardstate/core@0.4.0
  - @boardstate/host@0.4.0

## 0.1.4

### Patch Changes

- [`f2f23ae`](https://github.com/100yenadmin/boardstate/commit/f2f23ae1bb849eb357839debc0c675ed05484c1b) - Mac-style lift-and-carry drag: the dragged card now follows the pointer 1:1
  (raw pixel deltas from `DashboardDragState.pointerDx/Dy`), lifted with a shadow
  and a grabbing cursor, while the landing cell shows as a QUIET neutral
  placeholder — red stays reserved for an invalid (colliding) drop. Previously
  the card never moved and the snapped accent/red ghost rectangles were the only
  drag feedback, which read as "colored bars" instead of direct manipulation.
  Resize keeps the ghost preview. Also hardened: a pointer that vanishes between
  pointerdown and capture can no longer kill the drag wiring.
- Updated dependencies [[`f2f23ae`](https://github.com/100yenadmin/boardstate/commit/f2f23ae1bb849eb357839debc0c675ed05484c1b)]:
  - @boardstate/core@0.3.2
  - @boardstate/host@0.3.2

## 0.1.3

### Patch Changes

- [`9636400`](https://github.com/100yenadmin/boardstate/commit/963640033e7acdec2407dced868a4b979b2db07f) - Publish flow: `pnpm -r publish --provenance` + `changeset tag` — the third and
  loud-failing provenance attempt. `changeset publish` silently dropped provenance
  through BOTH `NPM_CONFIG_PROVENANCE` and `publishConfig.provenance`; the explicit
  `--provenance` flag errors when OIDC is unavailable instead of skipping, so this
  train either carries Sigstore attestations or the release run tells us exactly
  why not. No code changes.
- Updated dependencies [[`9636400`](https://github.com/100yenadmin/boardstate/commit/963640033e7acdec2407dced868a4b979b2db07f)]:
  - @boardstate/schema@0.3.1
  - @boardstate/core@0.3.1
  - @boardstate/host@0.3.1

## 0.1.2

### Patch Changes

- [`49655b2`](https://github.com/100yenadmin/boardstate/commit/49655b2d9826cba377dbc1afb971b57e1fae1084) - Enable npm provenance attestations declaratively (`publishConfig.provenance`):
  the 0.2.0 train's `NPM_CONFIG_PROVENANCE` env wiring was silently ignored by the
  publish path, so those tarballs carry registry signatures but no Sigstore
  attestation. The declarative flag fails loudly if OIDC is unavailable instead of
  skipping. No code changes.
- Updated dependencies [[`49655b2`](https://github.com/100yenadmin/boardstate/commit/49655b2d9826cba377dbc1afb971b57e1fae1084)]:
  - @boardstate/schema@0.2.1
  - @boardstate/core@0.2.1
  - @boardstate/host@0.2.1

## 0.1.1

### Patch Changes

- Updated dependencies [[`f86e99a`](https://github.com/100yenadmin/boardstate/commit/f86e99a8223638af4e89d24a4e1d14dfe0251f9a), [`052ee22`](https://github.com/100yenadmin/boardstate/commit/052ee223495829bc6769f0c1cff9e441f26631ca)]:
  - @boardstate/core@0.2.0
  - @boardstate/host@0.2.0

## 0.1.0

### Minor Changes

- [`21c0ed1`](https://github.com/100yenadmin/boardstate/commit/21c0ed107d8b1b890bd4278345427d79f36b03bb) - Add **`builtin:chat`** — the 16th builtin widget: the chat FACE of the control
  plane (SPEC §14). It drives the `chat.*` methods through a new injected `ctx.chat`
  seam (`send` / `abort` / `history` / `subscribe`, all bound to one `sessionKey`) and
  renders the `AgentStreamEvent` stream — start → delta\* → end text triads as
  sanitized markdown, consecutive tool calls collapsed into one group chip
  ("🔧 3 actions · ✓✓✗") with an expandable friendly-name log, a Stop button while a
  turn is live, an inline approval card when the agent scaffolds a widget mid-turn,
  and sticky-bottom autoscroll with a "Jump to latest" pill. It knows nothing about
  providers — the seam is the whole coupling.

  The render model is a pure, heavily-tested reducer (`reduceChatEvents`) that folds
  the raw event stream into ordered turns and defends the §14 ordering invariants
  (orphaned deltas, out-of-order ready/result, duplicate `turn-end`, abort mid-text)
  without ever throwing.

- [`ee374ab`](https://github.com/100yenadmin/boardstate/commit/ee374abe15da7942c08ff81d218c6e242e4810b8) - Ship a complete default theme, **"Graphite"** — a Linear/Vercel/Codex-family
  palette baked into `@boardstate/lit/styles.css` that looks world-class in **light
  and dark** out of the box. Dark mode activates automatically via
  `prefers-color-scheme` and can be pinned with `data-theme="dark"` / `"light"` on
  the document root.

  Also adds two bundled alternate themes, each with its own light + dark:

  - `@boardstate/lit/themes/aurora.css` — futuristic, cyan accent + aurora wash
  - `@boardstate/lit/themes/vibrancy.css` — macOS-native frosted glass, system-blue accent

  Import an alternate after `styles.css` to fully re-skin. See `THEME.md` for the
  token table and how to build your own.

- [`57888e4`](https://github.com/100yenadmin/boardstate/commit/57888e488469478876d5ebb18707456c75cb5397) - Initial release: the Boardstate protocol and runtime, extracted from the modular-dashboard system built for OpenClaw. Workspace document schema + validators, headless store with storage/transport adapters, the `dashboard.*` control plane with agent tools and jailed widget serving, the framework-free sandbox host with the postMessage bridge, the Lit reference view with 15 builtin widgets, React wrappers, an MCP server, and the transport conformance suite.

- [`8661565`](https://github.com/100yenadmin/boardstate/commit/86615650debbf62288ce40f3f5c8132a7d353fe0) - Localization: ship partial translations for 20 languages as `@boardstate/lit/locales/<code>` subpath exports (ported from the source project's catalogs; only keys whose English source matched Boardstate's English verbatim were carried over — unlisted keys fall back to the built-in English). Pass one to the view's `strings` property.

### Patch Changes

- [`878a149`](https://github.com/100yenadmin/boardstate/commit/878a149f4c9b5fa7091b7468a07acd2d746de562) - Fix a batch of reference-view defects (demo v3):

  1. Modal card overflow — `.bs-modal__card` now sizes to content with viewport
     rails (`max-width`/`max-height: calc(100vh/100vw - 48px)` + `overflow: auto`),
     so the gallery and history dialogs no longer clip on narrow viewports.
  2. Primary buttons — re-assert the accent surface in the Graphite polish block;
     the later `.bs-btn` reset had reverted primary buttons to white-on-white in
     light mode.
  3. Modal scrim — deepen to 60% black and add a `backdrop-filter: blur(3px)`.
  4. Add `color-scheme` (light on `:root`, dark on both dark blocks) so native
     scrollbars/controls match the theme.
  5. Custom-widget frame `min-height` 160px → 120px so an `h:3` cell no longer
     forces host scroll.
  6. Action-form — a rejected prompt dispatch now surfaces on the shared toast
     (`onActionError` → `state.actionError`) instead of being swallowed.
  7. RTL — `.dashboard-page-header__action-icon` uses `margin-inline-end`.
  8. Add minimal spacing rules for previously unstyled dialog classes
     (`.dashboard-gallery__header`, `.dashboard-gallery__item-body`,
     `.dashboard-history__diff-label`, `.dashboard-history__preview-wrap`).
  - RTL: per-element `unicode-bidi: plaintext` so untranslated English runs keep their punctuation on the correct side inside `dir="rtl"` pages.

- [`22d1a87`](https://github.com/100yenadmin/boardstate/commit/22d1a87cdbeb196675259666872d6adb586d5af4) - The first-visit onboarding banner ("Add your first workspace") now only renders
  while the workspace is genuinely unfurnished — no widgets on any tab. Previously
  it sat on top of fully composed/seeded boards until manually dismissed.
- Updated dependencies [[`57888e4`](https://github.com/100yenadmin/boardstate/commit/57888e488469478876d5ebb18707456c75cb5397), [`d045057`](https://github.com/100yenadmin/boardstate/commit/d045057a371d2073b32e0bc7f47cfdc56bccdc54)]:
  - @boardstate/schema@0.1.0
  - @boardstate/core@0.1.0
  - @boardstate/host@0.1.0
