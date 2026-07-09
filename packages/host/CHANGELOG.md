# @boardstate/host

## 0.3.1

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

## 0.2.1

### Patch Changes

- [`49655b2`](https://github.com/100yenadmin/boardstate/commit/49655b2d9826cba377dbc1afb971b57e1fae1084) - Enable npm provenance attestations declaratively (`publishConfig.provenance`):
  the 0.2.0 train's `NPM_CONFIG_PROVENANCE` env wiring was silently ignored by the
  publish path, so those tarballs carry registry signatures but no Sigstore
  attestation. The declarative flag fails loudly if OIDC is unavailable instead of
  skipping. No code changes.
- Updated dependencies [[`49655b2`](https://github.com/100yenadmin/boardstate/commit/49655b2d9826cba377dbc1afb971b57e1fae1084)]:
  - @boardstate/schema@0.2.1
  - @boardstate/core@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [[`f86e99a`](https://github.com/100yenadmin/boardstate/commit/f86e99a8223638af4e89d24a4e1d14dfe0251f9a), [`052ee22`](https://github.com/100yenadmin/boardstate/commit/052ee223495829bc6769f0c1cff9e441f26631ca)]:
  - @boardstate/core@0.2.0

## 0.1.0

### Minor Changes

- [`57888e4`](https://github.com/100yenadmin/boardstate/commit/57888e488469478876d5ebb18707456c75cb5397) - Initial release: the Boardstate protocol and runtime, extracted from the modular-dashboard system built for OpenClaw. Workspace document schema + validators, headless store with storage/transport adapters, the `dashboard.*` control plane with agent tools and jailed widget serving, the framework-free sandbox host with the postMessage bridge, the Lit reference view with 15 builtin widgets, React wrappers, an MCP server, and the transport conformance suite.

### Patch Changes

- Updated dependencies [[`57888e4`](https://github.com/100yenadmin/boardstate/commit/57888e488469478876d5ebb18707456c75cb5397), [`d045057`](https://github.com/100yenadmin/boardstate/commit/d045057a371d2073b32e0bc7f47cfdc56bccdc54)]:
  - @boardstate/schema@0.1.0
  - @boardstate/core@0.1.0
