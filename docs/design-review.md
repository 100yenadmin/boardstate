# Dashboard design — review & refine a layout you built

A workflow for an agent to **critique and improve a dashboard it just authored**,
instead of leaving the first draft. It is convention only: it uses the same
dashboard tools every agent already has and grants no extra privilege. Nothing
here bypasses the custom-widget approval gate — agent-authored custom widgets
stay `pending` until an operator approves them.

## The loop

1. **Snapshot.** Call `dashboard_workspace_get` to read the current workspace
   document. Everything below is judged against that document, never against
   your memory of what you intended to build.
2. **Evaluate** each tab against the heuristics below and write down concrete
   issues (widget id + what's wrong), not vibes.
3. **Refine** with the smallest tool that fixes each issue:
   - `dashboard_layout_set` — batch-reposition widgets on one tab (best for
     rebalancing a grid in a single call).
   - `dashboard_widget_move` — move one widget's grid, or move it to another tab.
   - `dashboard_widget_update` — retitle, resize, collapse, or (re)bind one widget.
   - `dashboard_widget_add` / `dashboard_widget_remove` — add a missing widget or
     drop a redundant one.
   - `dashboard_tab_create` / `dashboard_tabs_reorder` — split an overloaded tab or
     reorder tabs so the most-used one is first.
   - `dashboard_undo` — revert the **last** mutation if a refinement pass made
     things worse. Undo is a single-step ring; re-snapshot after undoing.
4. **Render-check (optional but recommended).** Structural heuristics can't see
   overlap artifacts, truncated titles, or an empty-looking data widget. Pair this
   review with a rendered screenshot via the preview widget's browser-backed mode
   (where your host supports it): open the workspace, capture the tab, and confirm
   the picture matches the document.
5. **Re-snapshot and repeat** until a pass produces no material change. Two or
   three passes is normal; stop at diminishing returns rather than churning.

## Grid & document constraints (hard limits)

The validator rejects anything outside these, so refinements must stay in bounds:

- 12-column grid. Each widget grid is `{ x: 0-11, y: 0-499, w: 1-12, h: 1-20 }`
  and **`x + w` must be ≤ 12** (no horizontal overflow).
- ≤ 24 widgets per tab; ≤ 32 tabs.
- Builtin kinds: `builtin:{stat-card, markdown, table, iframe-embed, sessions,
usage, cron, instances, activity}`. Custom kinds: `custom:<name>`.
- Bindings: `rpc` (allowlisted read method), `file` (path under the host's data
  dir, optional JSON pointer), or `static` (inline value, ≤ 8 KB serialized).

## Heuristics

**Balance.** Widgets should fill the 12 columns without large dead zones or a
lopsided pile in one corner. Watch for: everything crammed into the left 6
columns; a single row growing past what fits on screen because widgets never wrap;
one giant widget dwarfing the rest. Aim for rows that pack cleanly (e.g. two 6-wide
or three 4-wide widgets per row) and consistent heights within a row.

**Grouping.** One concern per tab, related widgets adjacent. A stat-card and the
table it summarizes belong next to each other; unrelated widgets (a cron list next
to a revenue chart) signal the tab is doing two jobs — split it with
`dashboard_tab_create` and move widgets over. Put the highest-signal widget top-left
(first thing read).

**Binding coverage.** Every data widget should resolve real data. Flag: a
data-shaped widget (`stat-card`, `table`, `usage`, `sessions`, `cron`,
`instances`, `activity`) with **no binding**, or a `static` placeholder left where
a live `rpc`/`file` binding was intended. Prefer an allowlisted `rpc` binding with
a JSON `pointer` over pasting a static snapshot that will go stale.

**Sizing to content.** Match `w`/`h` to what a widget shows: stat-cards are small
(≈ 3×2), tables are wide and tall enough to show several rows without scroll,
markdown notes size to their text. A 12×20 stat-card is a smell.

**Provenance & titles.** Every widget has a clear, ≤ 80-char title. Agent-authored
tabs/widgets carry an `agent:<id>` `createdBy` stamp — leave it; it drives the "AI"
provenance chip.

## Worked example A — rebalance a lopsided tab

`dashboard_workspace_get` returns an "Ops" tab where three widgets are stacked in
the left half and the right half is empty:

```json
{ "id": "presence", "kind": "builtin:instances", "grid": { "x": 0, "y": 0, "w": 6, "h": 3 } }
{ "id": "sessions", "kind": "builtin:sessions",  "grid": { "x": 0, "y": 3, "w": 6, "h": 4 } }
{ "id": "crons",    "kind": "builtin:cron",      "grid": { "x": 0, "y": 7, "w": 6, "h": 4 } }
```

Issue: **balance** — all three hug the left 6 columns; the right 6 are dead. Fix in
one call with `dashboard_layout_set` (tab `"ops"`), putting presence top-left,
sessions top-right, and crons across the bottom:

```json
{
  "tab": "ops",
  "layout": [
    { "id": "presence", "grid": { "x": 0, "y": 0, "w": 6, "h": 3 } },
    { "id": "sessions", "grid": { "x": 6, "y": 0, "w": 6, "h": 3 } },
    { "id": "crons", "grid": { "x": 0, "y": 3, "w": 12, "h": 4 } }
  ]
}
```

Re-snapshot; the grid now packs into two rows with no dead zone.

## Worked example B — close a binding gap

A "Finance" tab has a stat-card whose value is a hardcoded placeholder:

```json
{
  "id": "spend",
  "kind": "builtin:stat-card",
  "title": "Spend",
  "grid": { "x": 0, "y": 0, "w": 3, "h": 2 },
  "bindings": { "value": { "source": "static", "value": "$0.00" } }
}
```

Issue: **binding coverage** — a live metric is frozen behind a `static` value. Wire
it to the allowlisted `usage.cost` read method with a JSON pointer into the field
you want, via `dashboard_widget_update` (tab `"finance"`, id `"spend"`):

```json
{
  "tab": "finance",
  "id": "spend",
  "patch": {
    "bindings": { "value": { "source": "rpc", "method": "usage.cost", "pointer": "/total" } }
  }
}
```

Now the card resolves real spend on every refresh instead of showing a stale
literal. Re-snapshot and confirm the binding is present; render-check that the card
shows a number rather than an error.

---

Adapted from the reference implementation's documentation (openclaw/openclaw#101136 series).
