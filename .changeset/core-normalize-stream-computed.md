---
"@boardstate/core": patch
---

Fix `normalizeWorkspace` silently stripping `stream` and `computed` bindings: the
defensive client read-model normalizer only recognized `rpc`/`file`/`static`
sources, so a stream-bound widget lost its binding on every client load and
rendered "—" forever (the raw RPC response carried it fine). `DashboardBinding`
now also carries the `event`, `op`, `inputs`, and `arg` fields.
