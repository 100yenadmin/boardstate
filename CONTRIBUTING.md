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
