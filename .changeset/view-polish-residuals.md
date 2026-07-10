---
"@boardstate/lit": minor
---

View polish (issue #4): the version-history snapshot preview now reads as an
intentional layout — each cell shows a per-kind glyph (a faux sparkline for
charts, stacked rows for tables/lists, a value bar for stat cards; no live data
resolved) and the grid is captioned "Layout at version N". History list rows gain
a compact change summary ("+2 · 1 moved · actor"). The widget gallery list shows a
CSS-only scroll-shadow affordance when rows are cut off. The stylesheet's remaining
physical left/right properties were converted to logical equivalents
(`padding-inline`, `border-start-start-radius`, `text-align: start`, …) to harden
RTL. New English strings are added to the default table only.
