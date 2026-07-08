# Theming `@boardstate/lit`

`@boardstate/lit/styles.css` ships a complete, world-class default theme —
**"Graphite"** (a Linear/Vercel/Codex-family palette) — that looks great in
**light and dark** out of the box. Import it once and you're done:

```ts
import "@boardstate/lit";
import "@boardstate/lit/styles.css";
```

Every themeable value is a `var(--bs-<token>, <fallback>)`, so you can override
any single token on an ancestor of `<boardstate-view>`, drop in one of the bundled
alternate themes, or author your own — all without touching the view's markup.

## Light / dark

Dark mode activates two ways, so either the OS preference or an explicit toggle
drives it:

- **Automatic** — `prefers-color-scheme: dark` is honored with no code at all.
- **Explicit** — set `data-theme` on `<html>` (always wins over the OS):
  - `document.documentElement.dataset.theme = "dark"` → force dark
  - `document.documentElement.dataset.theme = "light"` → force light
  - remove the attribute → fall back to the OS preference

A minimal toggle:

```ts
const root = document.documentElement;
toggleBtn.addEventListener("click", () => {
  const dark = getComputedStyle(root).getPropertyValue("--bs-bg").trim() === "#0b0b0f";
  root.dataset.theme = dark ? "light" : "dark";
});
```

## Alternate themes (bundled)

Two extra themes ship in the package. Import one **after** `styles.css` to fully
re-skin — each redefines the whole token set and adds a few signature touches
(both include their own light + dark):

```ts
import "@boardstate/lit/styles.css";
import "@boardstate/lit/themes/aurora.css"; // futuristic — cyan accent, aurora wash, rationed glow
// or
import "@boardstate/lit/themes/vibrancy.css"; // macOS-native frosted glass, system-blue accent
```

## Build your own

Override the `--bs-*` tokens on `:root` (or any wrapper element). Follow the same
selector structure the bundled themes use so light/dark and explicit toggles all
compose correctly:

```css
:root {
  --bs-bg: #fbfbfd;
  --bs-card: #ffffff;
  --bs-text: #15151b;
  --bs-accent: #6c5bfa;
  /* …the rest of the token table… */
}
:root[data-theme="dark"] {
  --bs-bg: #0b0b0f;
  --bs-card: #131318;
  --bs-text: #ededf2;
  /* …dark overrides… */
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    /* repeat the dark overrides so OS-dark works without an explicit toggle */
  }
}
```

## Token table

Defaults below are the **Graphite light** values; each has a matching dark value
(see `:root[data-theme="dark"]` in `boardstate.css`).

| Token                    | Purpose                                        | Default (light)                                               |
| ------------------------ | ---------------------------------------------- | ------------------------------------------------------------- |
| `--bs-bg`                | App background (behind the view)               | `#fbfbfd`                                                     |
| `--bs-card`              | Widget / menu / dialog surface                 | `#ffffff`                                                     |
| `--bs-card-highlight`    | Slightly raised surface (widget bars, insets)  | `#f6f6fa`                                                     |
| `--bs-text`              | Primary text                                   | `#15151b`                                                     |
| `--bs-text-strong`       | Emphasized text (titles, active tab)           | `#000000`                                                     |
| `--bs-text-muted`        | Secondary / meta text                          | `#6b6b77`                                                     |
| `--bs-text-dim`          | Faint text (dots, dim glyphs)                  | `#9a9aa6`                                                     |
| `--bs-muted`             | Alias for muted text in some contexts          | `#6b6b77`                                                     |
| `--bs-border`            | Hairline borders                               | `#e7e7ee`                                                     |
| `--bs-border-strong`     | Stronger borders (dropzones, resize, hover)    | `#d9d9e2`                                                     |
| `--bs-bg-hover`          | Hover background wash                          | `#f2f2f7`                                                     |
| `--bs-bg-muted`          | Muted fill (code chips, tab strip, badges)     | `rgba(16,16,24,0.03)`                                         |
| `--bs-accent`            | Accent (active tab, chart, primary button)     | `#6c5bfa`                                                     |
| `--bs-accent-foreground` | Text on the accent surface                     | `#ffffff`                                                     |
| `--bs-danger`            | Danger / error                                 | `#d92c25`                                                     |
| `--bs-danger-subtle`     | Subtle danger wash (error badges/surfaces)     | `rgba(217,44,37,0.1)`                                         |
| `--bs-success`           | Live / ok status                               | `#27853c`                                                     |
| `--bs-warning`           | Degraded status                                | `#986d0d`                                                     |
| `--bs-input`             | Input surface (falls back to `--bs-border`)    | `#ffffff`                                                     |
| `--bs-ring`              | Focus-ring color (falls back to `--bs-accent`) | `rgba(108,91,250,0.5)`                                        |
| `--bs-focus-ring`        | Full focus-ring `box-shadow`                   | `0 0 0 2px rgba(108,91,250,0.45)`                             |
| `--bs-radius-sm`         | Small radius (chips, menu items)               | `6px`                                                         |
| `--bs-radius-md`         | Medium radius (buttons, tabs, menus)           | `9px`                                                         |
| `--bs-radius-lg`         | Large radius (cards, widgets)                  | `12px`                                                        |
| `--bs-radius-full`       | Pill radius (badges, provenance)               | `999px`                                                       |
| `--bs-shadow-md`         | Card / menu / modal shadow                     | `0 1px 2px rgba(16,16,24,.06), 0 6px 20px rgba(16,16,24,.08)` |
| `--bs-ease-out`          | Transition easing                              | `cubic-bezier(0.2,0.8,0.2,1)`                                 |
| `--bs-duration-fast`     | Fast transition duration                       | `120ms`                                                       |
| `--bs-font-sans`         | Body font                                      | `-apple-system, "SF Pro Text", system-ui, …`                  |
| `--bs-font-mono`         | Monospace (command chips, metadata)            | `ui-monospace, "SF Mono", Menlo, monospace`                   |

Custom-widget iframes receive theme tokens over the postMessage bridge (from
`@boardstate/host`'s `readThemeTokensFromRoot`), which reads the base token set
(`--bg`, `--card`, `--text`, `--accent`, …) from the document root — set those
alongside the `--bs-*` tokens if you host custom widgets.
