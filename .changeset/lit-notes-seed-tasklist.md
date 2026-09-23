---
"@boardstate/lit": patch
---

Connected `builtin:notes` pads now show the author/agent `props.text` seed until the user saves their own text (a persisted string, even an empty one, still wins); markdown GFM task lists (`- [ ]` / `- [x]`) render as ☐/☑ glyphs (no form controls); an ATX heading line ends at the newline so `# Title\nbody` renders a heading plus a paragraph; and the stylesheet now styles markdown headings and inline/fenced code so host resets don't flatten or restyle them.
