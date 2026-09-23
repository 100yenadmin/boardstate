---
"@boardstate/lit": patch
---

Connected `builtin:notes` pads now show the author/agent `props.text` seed (and pick up an updated seed on re-render) until the user types or a string is persisted — a persisted string, even an empty one, still wins. Markdown GFM task lists (`- [ ]` / `- [x]`) render as ☐/☑ glyphs (no form controls); an ATX heading line ends at the newline and a list directly under a heading renders as a list; and the stylesheet now styles markdown headings and inline/fenced code so host resets don't flatten or restyle them.
