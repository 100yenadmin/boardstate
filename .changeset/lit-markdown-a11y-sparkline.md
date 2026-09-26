---
"@boardstate/lit": patch
---

Three markdown/chart fixes:

- Markdown: an ATX heading's closing sequence (`## Roadmap ##`) is no longer rendered as part of the heading text. Per CommonMark only a space-preceded `#` run followed by nothing but spaces closes a heading, so `## Roadmap##` keeps its hashes.
- Markdown: the task-list glyph `aria-label`s are localized through the strings table (new keys `dashboard.widget.markdown.taskChecked` / `taskUnchecked`, translated in all 20 shipped locales; English stays the fallback) (#79).
- Chart: the sparkline value label now sits in its own column beside the end of the line, level with the last point, instead of overlapping the line's tip and clipping at the right edge (#81).
