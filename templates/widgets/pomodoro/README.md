# Pomodoro

A focus timer with work/break cycles, a depleting countdown ring, configurable
durations, and a completed-session counter — the second starter that persists
its state across reloads via the `state:persist` capability.

## What it demonstrates

- **`state:persist`** — the `dashboard:getState` / `dashboard:setState` bridge
  messages (identical envelope to `twenty48`). On boot it restores the phase,
  the remaining seconds, the completed-session count, and the configured
  work/break minutes; every meaningful change writes a tiny (<1 KB) blob back.
- **Honest persistence** — a restored timer comes back **paused**. There is no
  trustworthy elapsed-time source across an iframe remount, so it shows the
  saved remaining time and lets you resume rather than silently drifting.
- **Theme tokens** — reads `--bg` / `--card` / `--text` / `--accent` / `--border`
  from the host's `dashboard:theme` reply and follows the background luminance
  for its color scheme, so it looks right in both light and dark.
- **No bindings, no network** — everything is self-contained in one sandboxed
  HTML file.

## Controls

- **Start / Pause** — run or hold the current phase.
- **Reset** — restore the current phase to its full length.
- **Skip** — jump to the other phase without counting the current one.
- **⚙ Settings** — configurable focus / break minutes, persisted with the rest
  of the state.

The timer auto-advances at zero: a finished **Focus** phase increments the
session count and rolls into a **Break**, and vice versa.

## Capability

`state:persist` is declared in `widget.json`. Without the grant the parent
replies `capability_denied` and the timer runs in-memory (sessions reset on
remount) — it never breaks, it just forgets.
