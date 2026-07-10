---
"@boardstate/lit": minor
---

feat(chart): sparkline type + optional detail mode (#10, #4)

`builtin:chart` gains a distinct `sparkline` variant — a minimal axis-free line, delta-
colored by its trend (up/down/flat) with an optional trailing value label, degrading to a
single end dot at one point. A new opt-in `props.detail` layers labeled y-axis min/max
labels, faint gridlines, and per-point value tooltips (native `<title>`, no new dependency,
no `innerHTML`) over the line/bar/area/gauge types. Default charts render byte-identically —
the overlays are HTML siblings/SVG layers gated on the new props, so existing docs are
untouched. New CSS lives in a trailing `/* chart-detail */` block.
