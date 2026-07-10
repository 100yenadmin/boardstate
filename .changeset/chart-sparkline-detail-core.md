---
"@boardstate/core": minor
---

feat(chart): distinct sparkline model + opt-in detail mode (#10, #4)

`mapChart` now resolves two new props onto `ChartModel`: `detail` (labeled axes,
gridlines, and value tooltips) and `label` (a sparkline's trailing value badge). Both
opt in only on a strict `true`, so every existing chart doc maps to the same model as
before — `detail`/`label` default off. The catalog's `builtin:chart` entry documents the
two props and ships copy-pasteable `sparkline` and `detail` examples (both honesty-gated).
