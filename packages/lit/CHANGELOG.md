# @boardstate/lit

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
