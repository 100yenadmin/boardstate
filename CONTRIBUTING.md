# Contributing

Thanks for looking at Boardstate! A few things that will make your contribution land smoothly.

## Setup

```sh
pnpm install
pnpm build        # tsdown, all packages
pnpm test         # vitest, all packages
pnpm lint         # oxlint + prettier
```

Node ≥ 22, pnpm 11. Each package also runs standalone: `pnpm --filter @boardstate/core test`.

## The rules that matter here

1. **The spec is the contract.** [SPEC.md](packages/schema/SPEC.md) is normative. A behavior change to the document schema, the `dashboard.*` methods, the bridge protocol, or the security invariants needs a spec change in the same PR — and spec PRs land before (or with) implementation, never after.
2. **Wire shapes are pinned by the conformance suite.** If you touch the control plane, `@boardstate/conformance` must stay green — it exists because contract drift between mocked halves once shipped three P1 bugs in the reference implementation. Don't test against a mock of the other side; run the suite.
3. **Security invariants are not refactorable.** Anything touching the sandbox, CSP, approval flow, serving containment, or the prompt gate needs a test per invariant it grazes (see SPEC §11) and gets extra review scrutiny.
4. **Zero-dep discipline.** `@boardstate/schema` and `@boardstate/core` take no runtime dependencies. Hand-written validators are a feature, not an oversight.
5. **Additive schema evolution.** New document fields are optional-with-validation; `schemaVersion` bumps are a last resort and need a migration.

## PR checklist

- [ ] `pnpm build && pnpm test && pnpm lint` green at the root
- [ ] Spec updated if any contract changed
- [ ] A changeset (`pnpm changeset`) for anything user-visible
- [ ] New behavior has a test that fails without the change

## Releases

Releases are [changesets](https://github.com/changesets/changesets)-based. Every user-visible PR
includes a changeset (`pnpm changeset`); PRs that only touch internals, docs, or tests don't need one.

We run a **weekly release train**: a maintainer merges the changesets "Version Packages" PR on
Fridays, which cuts and publishes whatever changesets have accumulated since the last release.
Out-of-band releases are reserved for critical fixes that can't wait for the next Friday.

Boardstate is pre-1.0, so versions follow 0.x semantics rather than strict semver:

- **Minor** — a new capability. May include breaking changes, which must be called out explicitly in
  the changeset.
- **Patch** — a fix, with no capability or contract change.

We'll cut **1.0** once [SPEC.md](packages/schema/SPEC.md) is declared stable and the conformance suite
covers the full control plane.

`@boardstate/schema`, `@boardstate/core`, `@boardstate/host`, and `@boardstate/server` version
together (changesets `linked`) since they share the document/control-plane contract. `@boardstate/lit`,
`@boardstate/react`, and `@boardstate/mcp` version independently.
