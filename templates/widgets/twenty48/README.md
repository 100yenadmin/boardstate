# twenty48

A compact 2048 tile game showing off `state:persist` — best score and board
survive a reload.

Slide the numbered tiles, merge matching pairs, and try to reach the 2048 tile.
It's the one starter widget that exercises the write-back capability end to end.

## Controls

- **Arrow keys** or **WASD** to slide the whole board.
- **Swipe** (touch) in any direction.
- **New game** resets the board; your best score is kept.

Matching tiles merge into their sum, at most once per tile per move (so a row
of `[2, 2, 4]` slid left becomes `[4, 4]` and scores 4 — not `[8]`). After each
effective move a new `2` (90%) or `4` (10%) appears. Reach 2048 for the win
banner, then keep going for a higher score.

## How `state:persist` works

The widget declares `"capabilities": ["state:persist"]` in `widget.json`. That
gate lets it use exactly two bridge messages (see `packages/host/src/bridge.ts`):

- On boot it posts `{ v: 1, type: "dashboard:getState", requestId }`. The parent
  replies `{ v: 1, type: "dashboard:state", requestId, state, version }` with the
  last blob it saved for this widget (or `null` the first time).
- After each move (debounced ~500ms, and immediately on a new best) it posts
  `{ v: 1, type: "dashboard:setState", requestId, state }` with a tiny
  (`< 1KB`) `{ best, score, board, won, over }` blob. The widget id is bound by
  the host, so a widget can only ever read and write **its own** state.

Without the capability the parent answers `dashboard:error` with
`capability_denied`; the game handles that (and a standalone open with no host
at all) by running in-memory with `best = 0`. Every message uses the `v: 1`
envelope and anything without it is ignored — no network requests of any kind.

---

Installs from the demo gallery like the other starter widgets. Adapted from the
reference implementation's custom-widget templates.
