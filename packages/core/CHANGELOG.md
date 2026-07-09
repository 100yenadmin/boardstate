# @boardstate/core

## 0.2.0

### Minor Changes

- [`052ee22`](https://github.com/100yenadmin/boardstate/commit/052ee223495829bc6769f0c1cff9e441f26631ca) - `reviewWorkspace(doc)` — a pure 12-rule design lint powering agent self-review (M4a).

### Patch Changes

- [`f86e99a`](https://github.com/100yenadmin/boardstate/commit/f86e99a8223638af4e89d24a4e1d14dfe0251f9a) - Fix `normalizeWorkspace` silently stripping `stream` and `computed` bindings: the
  defensive client read-model normalizer only recognized `rpc`/`file`/`static`
  sources, so a stream-bound widget lost its binding on every client load and
  rendered "—" forever (the raw RPC response carried it fine). `DashboardBinding`
  now also carries the `event`, `op`, `inputs`, and `arg` fields.

## 0.1.0

### Minor Changes

- [`57888e4`](https://github.com/100yenadmin/boardstate/commit/57888e488469478876d5ebb18707456c75cb5397) - Initial release: the Boardstate protocol and runtime, extracted from the modular-dashboard system built for OpenClaw. Workspace document schema + validators, headless store with storage/transport adapters, the `dashboard.*` control plane with agent tools and jailed widget serving, the framework-free sandbox host with the postMessage bridge, the Lit reference view with 15 builtin widgets, React wrappers, an MCP server, and the transport conformance suite.

### Patch Changes

- Updated dependencies [[`57888e4`](https://github.com/100yenadmin/boardstate/commit/57888e488469478876d5ebb18707456c75cb5397), [`d045057`](https://github.com/100yenadmin/boardstate/commit/d045057a371d2073b32e0bc7f47cfdc56bccdc54)]:
  - @boardstate/schema@0.1.0
