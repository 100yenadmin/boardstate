# @boardstate/agent

## 0.5.0

### Minor Changes

- [#75](https://github.com/100yenadmin/boardstate/pull/75) [`6eb44b3`](https://github.com/100yenadmin/boardstate/commit/6eb44b389b14903662eeef0cf9ea515f98ee8803) Thanks [@100yenadmin](https://github.com/100yenadmin)! - Installable template recipes ([#60](https://github.com/100yenadmin/boardstate/issues/60)) + board-as-agent-memory ([#61](https://github.com/100yenadmin/boardstate/issues/61)).

  - **Template recipes ([#60](https://github.com/100yenadmin/boardstate/issues/60), `@boardstate/schema` + `@boardstate/core`).** A new
    `TemplateRecipe` format (`validateRecipe`) = a workspace doc + a `grantsManifest`
    (connector → requested tools with human labels), schema-validated and static-hostable
    (the registry index gains a `recipes[]` array). **Install = import:** the board is applied
    through the existing distribution re-pend seam (`buildRecipeImportDoc` →
    `sanitizeImportedWorkspace` → `dashboard.workspace.replace`), so every manifest grant
    lands `requested` and custom widgets `pending` — a recipe can **never** arrive
    pre-granted (proven at store ground truth through `reconcileReplaceApproval`). Ships two
    operational recipes — a keyless **Ops board** (the operational-demo's fake OfficeCLI
    connector, live end to end) and a **SaaS metrics + actions** board (builtins + an
    aggregator-shaped manifest) — plus an **Agent memory** template.
  - **Templates gallery tab ([#60](https://github.com/100yenadmin/boardstate/issues/60), `@boardstate/lit`).** The widget-gallery dialog grows a
    **Templates** tab that browses recipes and renders each recipe's honest "this board will
    ask for these tools" grant list before install; installing navigates to the board and the
    approvals widget surfaces the pending grant cards. New locale keys land in all five
    complete locales.
  - **Board-as-memory ([#61](https://github.com/100yenadmin/boardstate/issues/61), `@boardstate/agent`).** Opt-in `memory: "board"` on
    `createAgentChatAgent`: the system prompt gains the memory conventions
    (`buildSystemPrompt(tools, { memory: "board" })` / `MEMORY_CONVENTIONS`) and the runner
    **primes each turn** by reading a `memory` tab through the existing
    `dashboard_workspace_get` verb (no new tools). Additive and default-off — the prompt is
    byte-identical when off. See `docs/board-as-memory.md`.

### Patch Changes

- Updated dependencies [[`6eb44b3`](https://github.com/100yenadmin/boardstate/commit/6eb44b389b14903662eeef0cf9ea515f98ee8803), [`ddc2710`](https://github.com/100yenadmin/boardstate/commit/ddc2710ab1532ef66351cd6bd991ddf6568e9cc9)]:
  - @boardstate/schema@1.8.0
  - @boardstate/server@1.8.0

## 0.4.0

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
  - @boardstate/server@1.7.0

## 0.3.3

### Patch Changes

- Updated dependencies []:
  - @boardstate/server@1.6.0

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @boardstate/server@1.5.0

## 0.3.1

### Patch Changes

- Updated dependencies [[`ed04514`](https://github.com/100yenadmin/boardstate/commit/ed045143d925ba7a6479c8e969ee7e4beb0cc0f9)]:
  - @boardstate/server@1.4.0

## 0.3.0

### Minor Changes

- [#55](https://github.com/100yenadmin/boardstate/pull/55) [`52a3d3c`](https://github.com/100yenadmin/boardstate/commit/52a3d3c74d4bca8211c701ca844a8617f9d767e7) Thanks [@100yenadmin](https://github.com/100yenadmin)! - feat(agent): hard definition-token budget on shipped tool schemas (M5c-1)

  The runner shipped every tool's full definition each turn and history truncation never
  elided them, so an unbounded external (broker-granted) catalog would dwarf the prompt. The
  runner now caps the shipped definitions (`toolDefTokenBudget`): core tools always ship in
  full, `external` tools are kept most-recently-used-first until the budget is spent, and the
  rest collapse to a name + one-line summary + a `boardstate_tool_search` hint. A collapsed
  tool stays callable. The MRU persists per session across turns. Boards with no external tool
  ship every definition verbatim (byte-identical to the pre-M5 loop).

### Patch Changes

- Updated dependencies [[`52a3d3c`](https://github.com/100yenadmin/boardstate/commit/52a3d3c74d4bca8211c701ca844a8617f9d767e7)]:
  - @boardstate/server@1.3.0

## 0.2.8

### Patch Changes

- Updated dependencies [[`c895241`](https://github.com/100yenadmin/boardstate/commit/c8952418b9fd2b64a2a014927476502899d07938), [`b05c7cd`](https://github.com/100yenadmin/boardstate/commit/b05c7cd5c50d10b83374bad0dde92c128cd00470), [`a0feba7`](https://github.com/100yenadmin/boardstate/commit/a0feba7dc3939c577387c0509aa3fb1ba710e477)]:
  - @boardstate/server@1.2.0
  - @boardstate/schema@1.2.0

## 0.2.7

### Patch Changes

- Updated dependencies []:
  - @boardstate/server@1.1.0

## 0.2.6

### Patch Changes

- Updated dependencies [[`af1df09`](https://github.com/100yenadmin/boardstate/commit/af1df09e17e36d597243a0fe78121e6cf5c9cf17)]:
  - @boardstate/schema@1.0.0
  - @boardstate/server@1.0.0

## 0.2.5

### Patch Changes

- Updated dependencies [[`51a8ef9`](https://github.com/100yenadmin/boardstate/commit/51a8ef9a1259d0a3f994e725b1ceef58f74718ad)]:
  - @boardstate/server@0.5.1

## 0.2.4

### Patch Changes

- Updated dependencies [[`f147568`](https://github.com/100yenadmin/boardstate/commit/f147568a98a325357729f3b8e090c106d7114356)]:
  - @boardstate/server@0.5.0

## 0.2.3

### Patch Changes

- [`ccf0f89`](https://github.com/100yenadmin/boardstate/commit/ccf0f89e651473611de9f2793ae063e4d6fa578e) - The builtin-widget catalog — first-try correctness for agent-built boards. The
  first real external agent run (Hermes + GLM) guessed wrong widget prop/binding
  shapes and mounted empty widgets; the catalog prevents it instead of the review
  loop catching it after the fact.

  - **`@boardstate/core`**: `WIDGET_CATALOG` / `DATA_SOURCE_WIDGET_KINDS` — per
    builtin kind, the exact binding keys + value shapes, props, and a
    copy-pasteable example; every example is validated against the workspace
    schema in a unit test, so a copied example always mounts non-empty.
  - **`@boardstate/server`**: `dashboard_widget_catalog`, a readOnly tool in the
    browser-safe core tool set (flows through `@boardstate/mcp` as
    `boardstate_widget_catalog`). Optional `kind` filter.
  - **`@boardstate/agent`**: the system prompt now points the model at the
    catalog before its first `widget_add`, and the composition guide's
    table/markdown/action-form lines are corrected (a table binds `rows`, a
    markdown binds `content` — data goes in `bindings.<key>`, never in props).

  Two seam bugs fixed along the way (@boardstate/server):
  - `dashboard_widget_update` (the agent tool) threw `unexpected param: tab` on
    EVERY call — the addressing fields were never stripped before the patch
    reader, so agents could never patch a widget. Fixed + regression-tested.
  - Widget `props` sent as a JSON-encoded STRING (a routine model double-encode)
    sailed through validation and silently stripped every renderer's
    format/type/labels. The tool and RPC seams now coerce an unambiguous
    stringified object back to the object and reject other non-object props
    loudly.

- Updated dependencies [[`66cd58e`](https://github.com/100yenadmin/boardstate/commit/66cd58e952a50be721e1351d5540077ba29698bb), [`ccf0f89`](https://github.com/100yenadmin/boardstate/commit/ccf0f89e651473611de9f2793ae063e4d6fa578e)]:
  - @boardstate/server@0.4.0

## 0.2.2

### Patch Changes

- Updated dependencies []:
  - @boardstate/server@0.3.2

## 0.2.1

### Patch Changes

- [`9636400`](https://github.com/100yenadmin/boardstate/commit/963640033e7acdec2407dced868a4b979b2db07f) - Publish flow: `pnpm -r publish --provenance` + `changeset tag` — the third and
  loud-failing provenance attempt. `changeset publish` silently dropped provenance
  through BOTH `NPM_CONFIG_PROVENANCE` and `publishConfig.provenance`; the explicit
  `--provenance` flag errors when OIDC is unavailable instead of skipping, so this
  train either carries Sigstore attestations or the release run tells us exactly
  why not. No code changes.
- Updated dependencies [[`9636400`](https://github.com/100yenadmin/boardstate/commit/963640033e7acdec2407dced868a4b979b2db07f)]:
  - @boardstate/schema@0.3.1
  - @boardstate/server@0.3.1

## 0.2.0

### Minor Changes

- [`ff6fcf1`](https://github.com/100yenadmin/boardstate/commit/ff6fcf104979f2470c655ef213635b94a4bc0411) - `createAgentChatAgent({ selfReview: "once" })` — the self-building loop's first
  rung (SPEC §15, M4a). After a turn that mutated the board, the runner appends ONE
  bounded follow-up pass asking the model to call `dashboard_design_review`, fix the
  findings it agrees with, and summarize — same token/iteration ceilings, and the
  wire stays a single §14 turn (one `turn-start`, one terminal `turn-end`). Default
  `"off"`.

### Patch Changes

- Updated dependencies [[`ff6fcf1`](https://github.com/100yenadmin/boardstate/commit/ff6fcf104979f2470c655ef213635b94a4bc0411)]:
  - @boardstate/server@0.3.0

## 0.1.1

### Patch Changes

- [`49655b2`](https://github.com/100yenadmin/boardstate/commit/49655b2d9826cba377dbc1afb971b57e1fae1084) - Enable npm provenance attestations declaratively (`publishConfig.provenance`):
  the 0.2.0 train's `NPM_CONFIG_PROVENANCE` env wiring was silently ignored by the
  publish path, so those tarballs carry registry signatures but no Sigstore
  attestation. The declarative flag fails loudly if OIDC is unavailable instead of
  skipping. No code changes.
- Updated dependencies [[`49655b2`](https://github.com/100yenadmin/boardstate/commit/49655b2d9826cba377dbc1afb971b57e1fae1084)]:
  - @boardstate/schema@0.2.1
  - @boardstate/server@0.2.1

## 0.1.0

### Minor Changes

- [`f01f02d`](https://github.com/100yenadmin/boardstate/commit/f01f02d8a1f15ae8425a4a8b794e808734d6b56d) - Add **`@boardstate/agent`** (M2) — the provider loop that turns any LLM into a
  dashboard-building agent, a client of the control plane rather than anything baked into
  core. Ships `runAgentTurn` (the streaming loop: forwards provider deltas as
  `AgentStreamEvent`s per SPEC §14, runs read-only tools in parallel and mutating tools
  serially, enforces per-turn token + tool-iteration ceilings, and retries transient
  provider failures with exponential backoff + jitter), `createAgentChatAgent` (the
  `chat.send` adapter with in-memory per-session history and truncation-first context
  management), the `ProviderAdapter` interface with `anthropicAdapter` (Messages API) and
  `openAICompatAdapter` (the GLM/z.ai · OpenAI · Together · Ollama path, accumulating tool
  calls by callId so Ollama's `index:0` parallel-call quirk can't merge them), and
  `buildSystemPrompt` + a registerable `dashboard_composition_guide` tool distilled from
  `docs/composition-patterns.md`. Browser-safe main entry, zero `node:*` imports; keys are
  passed in by the host, never logged or written to the workspace document.

### Patch Changes

- Updated dependencies [[`b21993e`](https://github.com/100yenadmin/boardstate/commit/b21993ea67d274297ccb8d1f17f3ef1596bceecf)]:
  - @boardstate/server@0.2.0
