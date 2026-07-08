# Theming `@boardstate/lit`

`src/styles/boardstate.css` reads every themeable value as `var(--bs-<token>, <default>)`.
The defaults form a neutral **light** palette, so the stylesheet renders standalone.
Override any token on an ancestor of `<boardstate-view>` (e.g. `:root` or a wrapper
element) to retheme — including a full dark mode by supplying a dark token set.

```css
:root {
  --bs-bg: #0f1115;
  --bs-card: #171a21;
  --bs-text: #e6e8eb;
  --bs-text-muted: #9aa4b2;
  --bs-border: #262b34;
  --bs-accent: #7c8cff;
}
```

## Token table

| Token                    | Purpose                                        | Default                       |
| ------------------------ | ---------------------------------------------- | ----------------------------- |
| `--bs-bg`                | App background (behind the view)               | `#ffffff`                     |
| `--bs-card`              | Widget / menu / dialog surface                 | `#ffffff`                     |
| `--bs-card-highlight`    | Inset top highlight on inputs                  | `transparent`                 |
| `--bs-text`              | Primary text                                   | `#1a1d21`                     |
| `--bs-text-strong`       | Emphasized text (titles)                       | `#111418`                     |
| `--bs-text-muted`        | Secondary / meta text                          | `#6b7280`                     |
| `--bs-text-dim`          | Faint text (dots, dim glyphs)                  | `#9ca3af`                     |
| `--bs-muted`             | Alias for muted text in some contexts          | `#6b7280`                     |
| `--bs-border`            | Hairline borders                               | `#e5e7eb`                     |
| `--bs-border-strong`     | Stronger borders (dashed dropzones, resize)    | `#d1d5db`                     |
| `--bs-bg-hover`          | Hover background wash                          | `rgba(0,0,0,0.05)`            |
| `--bs-bg-muted`          | Muted fill (code chips, embeds, badges)        | `#f3f4f6`                     |
| `--bs-accent`            | Accent (active tab, provenance, primary btn)   | `#6366f1`                     |
| `--bs-accent-foreground` | Text on the accent surface                     | `#ffffff`                     |
| `--bs-danger`            | Danger / error                                 | `#ef4444`                     |
| `--bs-success`           | Live / ok status                               | `#22c55e`                     |
| `--bs-warning`           | Degraded status                                | `#f59e0b`                     |
| `--bs-input`             | Input border (falls back to `--bs-border`)     | `--bs-border`                 |
| `--bs-ring`              | Focus-ring color (falls back to `--bs-accent`) | `--bs-accent`                 |
| `--bs-radius-sm`         | Small radius (chips, menu items)               | `6px`                         |
| `--bs-radius-md`         | Medium radius (buttons, tabs, menus)           | `8px`                         |
| `--bs-radius-lg`         | Large radius (cards, widgets)                  | `12px`                        |
| `--bs-radius-full`       | Pill radius (badges, provenance)               | `999px`                       |
| `--bs-shadow-md`         | Menu / modal shadow                            | `0 8px 24px rgba(0,0,0,0.18)` |
| `--bs-ease-out`          | Transition easing                              | `ease-out`                    |
| `--bs-font-sans`         | Body font                                      | `system-ui, sans-serif`       |
| `--bs-font-mono`         | Monospace (command chips)                      | `ui-monospace, monospace`     |

Custom-widget iframes receive theme tokens over the postMessage bridge (from
`@boardstate/host`'s `readThemeTokensFromRoot`), which reads the base token set
(`--bg`, `--card`, `--text`, `--accent`, …) from the document root — set those
alongside the `--bs-*` tokens if you host custom widgets.
