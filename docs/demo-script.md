# Demo script — acceptance walkthrough

This is the scripted end-to-end tour that proves every major Boardstate feature
works, start to finish. Run it before tagging a release, after a protocol
change, or any time you want a repeatable "does this still work" pass instead
of clicking around ad hoc. Every step is executable against either the
[live demo](https://100yenadmin.github.io/boardstate/) or a local dev server —
each step says which.

Two tiers:

- **The 60-second tour** — the demo page's own scripted flow. Good enough for
  a quick sanity check or a screen recording for a PR/README.
- **The full acceptance walkthrough** — one Do/Observe section per feature
  area, including the two things the 60-second tour can't show you: security
  proof (devtools) and the parts that need a real server (file bindings,
  MCP, scaffolding to disk).

Record a screen capture of the 60-second tour when you want visual proof for
an issue or release note — the whole thing takes under a minute and shows the
core "agent builds it, human edits it" story in one continuous motion.

## Setup

Pick one:

1. **Zero-install** — open <https://100yenadmin.github.io/boardstate/>. This
   is the standalone example, no server, running entirely in the browser
   (`MemoryStorageAdapter`). Covers everything except file bindings and
   scaffold-to-disk.
2. **Local** —
   ```sh
   git clone https://github.com/100yenadmin/boardstate && cd boardstate
   pnpm install && pnpm build
   pnpm --filter boardstate-example-standalone dev
   ```
   Open the printed `localhost` URL. Same app as (1), served by Vite.
3. **With a real server** (only needed for the file-binding and scaffold
   steps below) —
   ```sh
   npx @boardstate/mcp --serve 4400
   ```
   This starts an MCP stdio server _and_ a live host page backed by
   `FsStorageAdapter` at `http://localhost:4400` — a real on-disk state dir,
   not memory. Use this host page instead of the standalone example for any
   step marked **[needs server]**.

Use Chrome (or Chrome via the `claude-in-chrome`/preview tooling if you're
running this from an agent) so devtools steps work the same way every time —
don't rely on a manual-only pass for the security checks.

## Part 1 — The 60-second tour

Open the demo page (setup step 1 or 2). Don't touch anything yet.

| #   | Do                                                                               | Observe                                                                                                                                              |
| --- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Read the header bar                                                              | Theme select (Graphite/Vibrancy/Aurora) + a light/dark toggle button, both live                                                                      |
| 2   | Click **🤖 Simulate agent**                                                      | Status line updates: _"creating a Sales tab…"_                                                                                                       |
| 3   | Watch (no clicks)                                                                | A "Sales" tab appears in the tab strip **with no page reload**                                                                                       |
| 4   | Keep watching                                                                    | A chart widget ("Weekly revenue") animates in, already bound to data                                                                                 |
| 5   | Keep watching                                                                    | Status line: _"scaffolding a custom widget… (it lands PENDING — needs your approval)"_ — a **card**, not an iframe, appears where the widget will go |
| 6   | Keep watching (~1.6s)                                                            | Status line: _"approving it (as the operator)…"_ then _"approved"_ — the pending card is replaced by a live sandboxed iframe rendering a chart       |
| 7   | Drag the chart widget to a new grid cell; resize it from its bottom-right handle | Both persist immediately — reload the page, layout is unchanged                                                                                      |
| 8   | Switch the theme select to Aurora, then Vibrancy                                 | Full re-skin, live, no reload                                                                                                                        |
| 9   | Click the light/dark toggle                                                      | Whole page flips light ↔ dark instantly                                                                                                              |

If all 9 land, the core story — _an agent composes a dashboard, a human edits
the same document, agent-authored code is safe to render_ — is intact.

## Part 2 — Full acceptance walkthrough

Run the 60-second tour first (Part 1), then continue from that state — the
"Sales" tab and its two widgets stay on the board for the rest of this
section.

### 2.1 Workspace edit — grid, collapse, hide, menu

| #   | Do                                            | Observe                                                                                           |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | Click the widget's title-bar kebab (`⋮`) menu | Menu opens: Pin, Edit title, Move to tab, Hide, Remove                                            |
| 2   | Click the collapse chevron on a widget        | Widget shrinks to its title bar only; chevron flips direction                                     |
| 3   | With a widget focused, press an arrow key     | Widget nudges one grid unit in that direction (keyboard parity for drag — no pointer needed)      |
| 4   | Open the kebab menu → **Hide**                | Widget disappears from the grid; check the tab-strip / widget-list surface for a way to unhide it |
| 5   | Drag a tab in the tab strip to reorder it     | New order persists on reload                                                                      |
| 6   | Reload the page entirely                      | Every change from steps 1–5 is still there — it's document state, not client state                |

### 2.2 Data bindings

| #   | Do                                                                                                                                                              | Observe                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | On the standalone demo                                                                                                                                          | The Sales chart is bound `source: "static"` — it never changes on its own, which is expected (no live data source in the zero-server demo) |
| 2   | **[needs server]** Start `npx @boardstate/mcp --serve 4400`, add a widget with a binding like `v=file:reports/q1.json#/total` (via the CLI or an MCP tool call) | Widget reads the JSON file under the state dir at the given JSON-pointer path                                                              |
| 3   | **[needs server]** Edit that file on disk and trigger a refresh/poll                                                                                            | Widget value updates without a page reload                                                                                                 |
| 4   | **[needs server]** Try a binding path with `../` in it                                                                                                          | Rejected — bindings are jailed to the state dir, no traversal                                                                              |

### 2.3 Custom widget: scaffold, approval, sandbox proof

This is the security story — verify it with devtools, not just eyeballing
that the widget "looks fine."

| #   | Do                                                                                                                                                        | Observe                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | Re-run the 60-second tour's simulate flow (or, **[needs server]**, run the scaffold command/tool to write a fresh widget to `<stateDir>/widgets/<name>/`) | A pending-approval **card** appears — no iframe exists yet                                                              |
| 2   | Click **Approve**                                                                                                                                         | An iframe mounts and renders                                                                                            |
| 3   | Open devtools → Elements, find the widget's `<iframe>`                                                                                                    | `sandbox="allow-scripts"` is present and **`allow-same-origin` is absent** — this is what makes the child origin opaque |
| 4   | Open devtools → Network, reload the widget's asset request                                                                                                | Response header `Content-Security-Policy` includes `connect-src 'none'`                                                 |
| 5   | Open devtools → Console, select the iframe's context, run `fetch("/")`                                                                                    | Fails — no network egress from inside the sandbox                                                                       |
| 6   | In the URL bar, try to request a widget asset with `../` in the path (e.g. `<widget-asset-url>/../../etc/passwd`)                                         | 404 — never a 403, never a directory listing (asset serving is deny-by-default with path-jail containment)              |
| 7   | **[needs server]** Request any asset for a widget whose `widgetsRegistry` status isn't `"approved"`                                                       | 404, even though the file exists on disk — approval gates serving, not just rendering                                   |
| 8   | Edit a scaffolded widget's `index.html` to `throw` on load, reload                                                                                        | Only that cell shows an error card — the rest of the dashboard, other tabs, other widgets are unaffected                |

### 2.4 History — time-travel and restore

| #   | Do                                                                      | Observe                                                                                                                              |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Click the history/time-travel toggle in the header                      | A panel opens listing prior versions of the workspace document                                                                       |
| 2   | Select an older version                                                 | A preview/diff renders: what changed between that version and now (tab added, widget moved, retitled, etc.), grouped by actor        |
| 3   | Click **Restore** on an older version                                   | A confirm step appears before it commits                                                                                             |
| 4   | Confirm                                                                 | The workspace reverts to that version; the change itself is a new document version (restoring is additive, not a rewrite of history) |
| 5   | Undo the most recent single mutation (drag a widget, then trigger undo) | Only that one change reverts — this is a distinct, lighter-weight path from full history restore                                     |

### 2.5 Export / import round-trip

| #   | Do                                                                                           | Observe                                                                               |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | Click **Export** in the toolbar                                                              | A JSON file downloads — the full workspace document                                   |
| 2   | Open the file                                                                                | Readable, diffable JSON: tabs, widgets, layout, bindings, `widgetsRegistry`           |
| 3   | Make a visible change (move a widget), then click **Import** and select the file from step 1 | The dashboard reverts to exactly the exported state                                   |
| 4   | Re-export and diff against the file from step 1                                              | Byte-for-byte equivalent modulo version/timestamp fields — the round-trip is lossless |

### 2.6 Widget gallery — registry install

| #   | Do                                                                                                   | Observe                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Click the gallery/widget-browse button in the header                                                 | A dialog opens asking for a registry index URL                                                                                                                            |
| 2   | Enter a registry `index.json` URL (see `templates/` for a starter, or host one yourself) and load it | A list of installable widgets renders with name + description                                                                                                             |
| 3   | Select one                                                                                           | Its declared capabilities and data bindings are shown **before** you install — nothing is hidden                                                                          |
| 4   | Click Install                                                                                        | The widget lands the same way a scaffolded one does: **pending approval**, no iframe until you approve it (installing never auto-approves and never bypasses the sandbox) |
| 5   | Try a bundle over the size cap, or a malformed `index.json`                                          | A clear inline error, not a silent failure or a hang                                                                                                                      |

### 2.7 Theming

| #   | Do                                                                                                         | Observe                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | With no `data-theme` attribute on `<html>` and the OS in dark mode, load the page                          | Dashboard renders in dark automatically (`prefers-color-scheme` honored, zero config)                                                               |
| 2   | Switch the OS to light mode, reload                                                                        | Dashboard follows to light                                                                                                                          |
| 3   | Set `<html data-theme="dark">` (devtools or the page's own toggle)                                         | Dark mode is now pinned regardless of OS setting                                                                                                    |
| 4   | Switch the theme select between Graphite / Aurora / Vibrancy                                               | Each is a full re-skin (its own light + dark pair) layered as a drop-in stylesheet over the Graphite base — no reload, no flash of unstyled content |
| 5   | Inspect a `--bs-*` custom property (e.g. `--bs-accent`) on `:root` in devtools before/after a theme switch | Value changes — confirms theming is CSS custom properties, not a JS re-render                                                                       |

### 2.8 Per-agent tab grouping

| #   | Do                                                                                                                                                    | Observe                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | Have two tabs created by different actors (the Sales tab from the simulate flow is `agent:sales-bot`; create or drag-create a second tab as yourself) | Once more than one actor owns visible tabs, the tab strip switches from flat to **grouped**, with a foldable header per actor |
| 2   | Click a group header to collapse it                                                                                                                   | That actor's tabs hide from the strip; the group shows a count badge                                                          |
| 3   | Reduce back down to tabs from a single actor (delete or hide the others)                                                                              | The strip returns to flat — no group chrome when there's nothing to disambiguate                                              |

## What a PASS looks like

- [ ] All 9 rows of the 60-second tour land with no console errors.
- [ ] Workspace edits (drag, resize, collapse, hide, reorder) survive a full page reload.
- [ ] A custom widget is a **pending card, not an iframe**, until explicitly approved.
- [ ] The approved widget's iframe has `sandbox="allow-scripts"` and **no** `allow-same-origin`.
- [ ] The widget's asset response carries `Content-Security-Policy: connect-src 'none'`, and `fetch()` from inside the iframe fails.
- [ ] A path-traversal or unapproved-asset request 404s — never 403, never a listing.
- [ ] A widget that throws on load only breaks its own cell — the rest of the dashboard keeps working.
- [ ] History shows a real changelist with actor attribution; restore requires confirmation and lands as a new version, not a silent rewrite.
- [ ] Export → Import round-trips the document losslessly.
- [ ] A gallery install lands pending, same as a scaffold — no privileged fast path.
- [ ] `prefers-color-scheme` works with zero config; `data-theme` overrides it; all three shipped themes (Graphite/Aurora/Vibrancy) render light and dark.
- [ ] Two-plus actors owning tabs triggers per-agent grouping; one actor keeps the strip flat.
- [ ] A second browser/profile pointed at the **same server-backed host** (`--serve`) shows identical state — it's server-side document state, not `localStorage`.

If every box is checked, the protocol's core claim — _one validated document,
edited by agents and humans through the same guarded control plane, with
agent-authored code safe to render by construction_ — holds end to end.
