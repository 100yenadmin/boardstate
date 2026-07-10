# Composition patterns — which widget for which job

A field guide for **agents composing dashboards** (and the humans reviewing them).
The platform's design principle: **we ship the vocabulary, you write the sentences.**
Builtins are the trusted vocabulary — they render without approval, inherit the theme,
and behave identically in every host. Custom widgets are the sentences that need their
own words: bespoke rendering, interactivity, or capabilities. Reach for a builtin
first; scaffold a custom widget only when no builtin fits.

## The builtin vocabulary

Every builtin takes a `bindings.value` (any binding source — `static`, `rpc`, `file`,
`stream`, `computed`) unless noted. Shapes below are the `static` forms; transforms
degrade gracefully on partial data (they never throw).

| Kind                   | Use for                              | Value / props essentials                                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `builtin:stat-card`    | One number that matters              | `value`: number or string · `props.format`: `"usd"` \| plain · `props.metric` label                                                                                                                                                                                                               |
| `builtin:table`        | Rows and columns                     | rows/columns via `props` (see any template) — keep ≤ ~10 visible rows                                                                                                                                                                                                                             |
| `builtin:chart`        | Trends, comparisons, budgets         | `value`: number array (or labeled points) · `props.type`: `area` \| `bar` \| `line` \| `gauge` \| `sparkline` (minimal, trend-colored, `props.label: true` for a trailing value — the right pick inside stat rows) · `props.detail: true` for labeled axes/gridlines/tooltips on the bigger types |
| `builtin:activity`     | Event feed                           | `value`: `{ entries: [{ ts, jobName, status, summary }] }`                                                                                                                                                                                                                                        |
| `builtin:markdown`     | Prose, explanations, small md tables | `value`: markdown string (sanitized render)                                                                                                                                                                                                                                                       |
| `builtin:notes`        | Operator scratch text                | `props.text` starter content                                                                                                                                                                                                                                                                      |
| `builtin:action-form`  | The chat↔dashboard loop              | form fields in `props`; submission goes back through the control plane (see living-answers.md)                                                                                                                                                                                                    |
| `builtin:sessions`     | Who/what is running                  | `value`: rows `{ key, label, status, hasActiveRun, updatedAt }` · `props.limit`                                                                                                                                                                                                                   |
| `builtin:agent-status` | Agents + their goals/progress        | sessions shape + `goal: { objective, tokensUsed, tokenBudget }`                                                                                                                                                                                                                                   |
| `builtin:usage`        | Cost/token totals                    | `value`: `{ totals: { totalCost, totalTokens }, days? }`                                                                                                                                                                                                                                          |
| `builtin:cron`         | Scheduled jobs                       | `value`: `{ jobs: [{ id, name, enabled, state: { nextRunAtMs, lastRunStatus } }] }`                                                                                                                                                                                                               |
| `builtin:instances`    | Fleet presence                       | `value`: `{ presence: [{ instanceId, platform, version, lastInputSeconds }] }`                                                                                                                                                                                                                    |
| `builtin:approvals`    | Pending widget approvals             | **ignores bindings** — reads the live registry; renders empty until something is pending                                                                                                                                                                                                          |
| `builtin:preview`      | A live page with viewport controls   | `props.url` (+ `props.defaultViewport`) — relative/same-origin allowed; cross-origin needs host opt-in                                                                                                                                                                                            |
| `builtin:iframe-embed` | A live page, chromeless              | `props.url` — same URL policy as preview                                                                                                                                                                                                                                                          |
| `builtin:chat`         | Talk to the agent, watch it work     | **ignores bindings** — drives `chat.*` + renders the `AgentStreamEvent` stream (§14) · `props.placeholder?`                                                                                                                                                                                       |

**[`templates/showcase.json`](../templates/showcase.json) exercises every kind above
with working static shapes — treat it as the few-shot reference when composing.**

## When to scaffold a custom widget instead

A custom widget (SPEC §8) is the right call when the job needs any of:

- **Bespoke rendering** — a visualization or layout no builtin provides.
- **Interactivity beyond a form** — direct manipulation, canvas, a game
  (see the `twenty48` registry entry).
- **Capabilities** — `data:read` (resolve manifest-declared bindings via the parent),
  `prompt:send` (single gated prompt), `state:persist` (64 KB write-back that survives
  reloads). Declare only what you use; the manifest is the security boundary.

Know what you're opting into: customs run in a sandboxed iframe (opaque origin, no
network, `allow-scripts` only), land **pending**, and render nothing until a human
approves. That approval moment is a feature — design widgets whose manifest
(bindings + capabilities) reads as obviously safe.

## Composition rules of thumb

1. **Lead with the number, follow with the why** — stat cards top-left, the explaining
   chart/table beside, prose (markdown) last. 12-column grid; don't overlap.
2. **One tab, one question.** Name tabs after the question they answer ("Today",
   "Triage", "Incidents") — not after data sources.
3. **Answer visually, not verbosely** — when the user asks a data question, compose
   widgets instead of writing paragraphs (the convention: [living-answers.md](living-answers.md)).
4. **Static first, live later.** Compose the layout with `static` bindings so it's
   reviewable immediately; swap to `rpc`/`stream`/`file` bindings once the shape is agreed.
5. **Critique your own board once** before finishing ([design-review.md](design-review.md)):
   contrast, density, does the first screen answer the question?
6. **Templates are primers, not products.** Start from
   [`templates/`](../templates/README.md) when one is close; replace its data, keep its bones.

## Where things come from

- Compose via the `dashboard.*` control plane (tools/MCP/CLI/RPC — all equivalent; SPEC §5).
- Install shared widgets from a **gallery registry** (`templates/registry/` is a
  ready-made one) — installs land pending, exactly like scaffolds.
- Author new widgets: [authoring.md](authoring.md).
