---
"@boardstate/schema": patch
"@boardstate/core": patch
"@boardstate/host": patch
"@boardstate/server": patch
"@boardstate/lit": patch
"@boardstate/react": patch
"@boardstate/mcp": patch
"@boardstate/agent": patch
---

Enable npm provenance attestations declaratively (`publishConfig.provenance`):
the 0.2.0 train's `NPM_CONFIG_PROVENANCE` env wiring was silently ignored by the
publish path, so those tarballs carry registry signatures but no Sigstore
attestation. The declarative flag fails loudly if OIDC is unavailable instead of
skipping. No code changes.
