---
"@boardstate/schema": patch
"@boardstate/core": patch
"@boardstate/host": patch
"@boardstate/server": patch
"@boardstate/lit": patch
"@boardstate/react": patch
"@boardstate/mcp": patch
"@boardstate/agent": patch
"@boardstate/conformance": patch
---

Publish flow: `pnpm -r publish --provenance` + `changeset tag` — the third and
loud-failing provenance attempt. `changeset publish` silently dropped provenance
through BOTH `NPM_CONFIG_PROVENANCE` and `publishConfig.provenance`; the explicit
`--provenance` flag errors when OIDC is unavailable instead of skipping, so this
train either carries Sigstore attestations or the release run tells us exactly
why not. No code changes.
