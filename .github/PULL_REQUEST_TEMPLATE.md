## What & why

<!-- One paragraph: the problem, the approach. Link the issue. -->

## Checklist

- [ ] `pnpm build && pnpm test && pnpm lint` green at the root
- [ ] **Spec**: no contract change, OR SPEC.md updated in this PR (document schema / `dashboard.*` methods / bridge protocol / invariants)
- [ ] **Conformance**: `@boardstate/conformance` green (required for any control-plane change)
- [ ] **Security**: if this grazes the sandbox, CSP, approval flow, serving containment, or the prompt gate — one test per invariant touched (SPEC §11)
- [ ] Changeset added (`pnpm changeset`) for user-visible changes
- [ ] New behavior has a test that fails without this change
