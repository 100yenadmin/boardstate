// Neutral inline-SVG glyphs for the reference view chrome. Hand-drawn, dependency
// free (the source pulled from an app icon set that is not part of this project).
// Each is a bare `<svg>` template sized by the consuming CSS (1em square, stroked
// with currentColor). `tab.icon` names are looked up here with an `Object.hasOwn`
// guard, so an unknown icon name simply renders nothing.

import { html, svg, type TemplateResult } from "lit";

function glyph(paths: TemplateResult): TemplateResult {
  return html`<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    ${paths}
  </svg>`;
}

export const icons = {
  spark: glyph(
    svg`<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2" />`,
  ),
  x: glyph(svg`<path d="M18 6L6 18M6 6l12 12" />`),
  plus: glyph(svg`<path d="M12 5v14M5 12h14" />`),
  eyeOff: glyph(
    svg`<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C5 20 1 12 1 12a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22" />`,
  ),
  chevronRight: glyph(svg`<path d="M9 18l6-6-6-6" />`),
  chevronDown: glyph(svg`<path d="M6 9l6 6 6-6" />`),
  arrowUpDown: glyph(svg`<path d="M7 15l5 5 5-5M7 9l5-5 5 5" />`),
  moreHorizontal: glyph(
    svg`<circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />`,
  ),
  externalLink: glyph(
    svg`<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14L21 3" />`,
  ),
  clock: glyph(svg`<circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />`),
  puzzle: glyph(
    svg`<path d="M4 7h3a1.5 1.5 0 1 0 3 0h3v3a1.5 1.5 0 1 1 0 3v3h-3a1.5 1.5 0 1 0-3 0H4v-3a1.5 1.5 0 1 1 0-3z" />`,
  ),
  maximize: glyph(
    svg`<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />`,
  ),
  minimize: glyph(
    svg`<path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />`,
  ),
} as const;

export type IconName = keyof typeof icons;
