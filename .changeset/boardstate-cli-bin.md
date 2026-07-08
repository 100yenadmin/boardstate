---
"@boardstate/server": minor
---

Ship a runnable **`boardstate`** CLI binary. `@boardstate/server` now declares a
`boardstate` bin (`dist/bin.js`) that wires the full `dashboard` command tree
(`tabs` / `widgets` / `layout` / `widget-scaffold`) over a local state dir —
`$BOARDSTATE_STATE_DIR`, else `~/.boardstate`, created on demand.

It also adds the top-level `boardstate tab add <name>` shortcut that the empty-state
onboarding copy advertises; it's an alias for `dashboard tabs create --title`, driving
the same `dashboard.tab.create` control-plane method (no privileged path).

```sh
npx --package @boardstate/server boardstate tab add sales
```
