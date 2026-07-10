# Habit Tracker

A rolling 7-day check-in grid: tap a day to mark the habit done, watch the
current streak update, and rename the habit inline — all persisted across
reloads via the `state:persist` capability.

## What it demonstrates

- **`state:persist`** — the `dashboard:getState` / `dashboard:setState` bridge
  messages (same envelope as `twenty48` and `pomodoro`). Completions are keyed by
  local calendar date, so the 7-day window rolls forward on its own and a
  checked day stays checked across reloads.
- **Derived UI** — the streak count is computed from the stored completions
  (consecutive days ending today, or yesterday if today is still blank), not
  stored separately, so it can never drift out of sync.
- **Theme tokens** — reads `--bg` / `--card` / `--text` / `--accent` / `--border`
  from the host's `dashboard:theme` reply and follows the background luminance,
  so it reads cleanly in both light and dark.
- **No bindings, no network** — one self-contained sandboxed HTML file.

## Controls

- **Tap a day** — toggle that day's check. Today is highlighted; earlier days in
  the window are tappable too, for backfilling a missed check-in.
- **Click the title** — rename the habit (persisted, up to 40 characters).

## Capability

`state:persist` is declared in `widget.json`. Without the grant the parent
replies `capability_denied` and the tracker runs in-memory (checks reset on
remount) — it degrades, it never breaks. To keep the persisted blob small, only
the last ~90 days of completions are retained.
