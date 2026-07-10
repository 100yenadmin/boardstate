---
"@boardstate/lit": minor
---

feat(chart): sparkline type + optional detail mode (#10, #4)

`builtin:chart` gains a distinct `sparkline` variant — a minimal axis-free line, delta-
colored by its trend (up/down/flat) with an optional trailing value label, degrading to a
single end dot at one point. A new opt-in `props.detail` layers labeled y-axis min/max
labels, faint gridlines, and per-point value tooltips (native `<title>`, no new dependency,
no `innerHTML`) over the line/bar/area/gauge types. Line/bar/area/gauge charts without the
new props render byte-identically — the overlays are HTML siblings/SVG layers gated on the
new props. Docs already using `type:"sparkline"` (previously a fallthrough that drew a
plain line) now get the true sparkline rendering — an intended visual upgrade whose
`dashboard-chart__spark*` classes replace the bare polyline. New CSS lives in a trailing
`/* chart-detail */` block.
