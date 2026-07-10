---
name: boardstate-dev
description: The Boardstate development loop — monorepo commands, scoped testing, changesets + release trains, the security-invariant verify discipline, and the house rules (wire-contract tests, inert rendering, reads≠actions). Use when implementing, reviewing, or releasing any change in this repo.
---

# Boardstate development

Read [AGENTS.md](../../../AGENTS.md) §5 first (layout, commands, read-first list). This
skill adds the _process_ that isn't obvious from the tree.

## The loop

1. **Branch off `main`** (worktree for anything non-trivial). Never commit to main directly
   except docs-only follow-ups.
2. **Scoped gates locally, full matrix in CI.** `pnpm --filter @boardstate/<pkg> test` for
   what you touched + root `pnpm typecheck` + `pnpm lint` (oxlint zero-warnings + prettier).
   Do not run the full suite locally — CI runs Node 22 + 24.
3. **Changeset per behavior change** (`.changeset/*.md`, patch/minor per touched package).
   Docs/examples-only changes need none.
4. **PR → CI green → merge.** The changesets bot opens a **Version Packages** PR; merging it
   IS the release train (publishes all bumped packages with npm provenance). One train per
   batch — let related PRs ride together.
5. **After the train:** verify `dist.attestations` on the registry for each published
   version (registry curl, not `npm view` — this machine pins `min-release-age`).

## Verify discipline (this repo's record: 10 real defects caught this way)

Green tests prove the happy path; the seams need adversaries. Before merging anything
touching **grants, the pending-action engine, the sandbox, bindings, or the agent tools**:

- Run an adversarial pass per named invariant (SPEC §11/§17/§18): one skeptic per invariant,
  prompted to REFUTE with concrete inputs and file:line citations.
- **Gate every caller.** A guarded mutation reachable via >1 path (RPC / agent tool /
  import / CLI) is only as strong as its weakest caller — grep every call site; don't trust
  the gate's own "holds for all callers" comment. (The agent `workspace.replace` self-grant
  bypass shipped exactly this way.)
- **Reads ≠ actions.** A read path must never reuse a side-effecting verb. If a "read" can
  park, queue, or mutate, it's the wrong verb (`dashboard.connector.read` exists because a
  read binding routed through `action.invoke` parked mutations on every refresh).
- **Claim-before-await** for single-shot actions (mark terminal synchronously before the
  first `await`) and **compute-under-the-lock** for read-modify-write unions (inside the
  store's mutate producer, never from an earlier unlocked read).
- **Functional ≠ visually correct.** After UI-adjacent changes, look at the rendered board
  (preview server / demo), not just the render model — a missing stylesheet passes every test.

## House rules

- **Wire-contract tests at every client↔server seam** — assert the exact param shape that
  crosses the wire (`{ tab, id, patch }`, not each side vs. its own mock).
- **External/untrusted strings render as text bindings.** No `unsafeHTML`/`innerHTML`
  outside the vetted markdown path. Tool results, descriptions, and refusals carry the
  untrusted-data framing.
- **Comments explain constraints** (why this order, what breaks otherwise), not narration.
- **Secrets are `${ENV}` refs, node-side only** — never literals in configs/docs, never
  anything the browser or document can see.
- **The widget catalog is honesty-gated** — any new builtin or prop change updates
  `packages/core/src/widget-catalog.ts`, and its example must pass `validateWorkspaceDoc`.

## Where things live

- Protocol: `packages/schema/SPEC.md` (§11 invariants, §17 capabilities/tool grants,
  §18 connector broker). Architecture seams: `docs/ARCHITECTURE.md`.
- The operate loop, runnable: `examples/operational-demo/` (keyless).
- Release checklist: `docs/release-checklist.md`. Roadmap: `docs/ROADMAP.md`.
