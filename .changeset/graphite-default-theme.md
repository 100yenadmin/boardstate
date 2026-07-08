---
"@boardstate/lit": minor
---

Ship a complete default theme, **"Graphite"** — a Linear/Vercel/Codex-family
palette baked into `@boardstate/lit/styles.css` that looks world-class in **light
and dark** out of the box. Dark mode activates automatically via
`prefers-color-scheme` and can be pinned with `data-theme="dark"` / `"light"` on
the document root.

Also adds two bundled alternate themes, each with its own light + dark:

- `@boardstate/lit/themes/aurora.css` — futuristic, cyan accent + aurora wash
- `@boardstate/lit/themes/vibrancy.css` — macOS-native frosted glass, system-blue accent

Import an alternate after `styles.css` to fully re-skin. See `THEME.md` for the
token table and how to build your own.
