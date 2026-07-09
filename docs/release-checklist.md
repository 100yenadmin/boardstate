# Release checklist (weekly train — Fridays)

1. **Merge the Version PR** (changesets keeps it current on `main`).
2. **Watch the Release workflow** → `changeset publish` output lists every package.
3. **Verify public visibility** (registry, not local npm — local `.npmrc` pins may
   hide fresh releases): `curl -s https://registry.npmjs.org/@boardstate%2fcore | jq -r '."dist-tags".latest'`
   New-org/package publishes can sit in npm review for ~30–60 min (accepted but
   anonymous-404). Re-running the release job prints "already published" — that's
   the tell it's a visibility hold, not a failed publish.
4. **Verify provenance attestations** on one package:

   > ⚠️ Provenance history: the 0.2.0/0.2.1 trains published WITHOUT attestations.
   > Root causes found: (a) `NPM_CONFIG_PROVENANCE` env alone is silently ignored on
   > the changesets→pnpm publish path; (b) the `repository.url` shorthand
   > (`github:owner/repo`) breaks sigstore's manifest match — it must be the
   > normalized `git+https://github.com/owner/repo.git`. Both fixed on main
   > (publishConfig.provenance + normalized URLs). If a train still lacks
   > attestations, escalate to npm trusted publishing (OIDC, npm ≥11.5.1).

   `npm view @boardstate/core dist.attestations --userconfig /dev/null`.

5. **Clean-dir install smoke**: `cd $(mktemp -d) && npm init -y && npm i @boardstate/core @boardstate/lit && node --input-type=module -e "import('@boardstate/core').then(m=>console.log(Object.keys(m).length,'exports'))"`.
6. **Update epics/milestone** with what shipped; move the roadmap if a milestone closed.
7. Out-of-band releases only for critical fixes (same steps).
