# @boardstate/agent

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
