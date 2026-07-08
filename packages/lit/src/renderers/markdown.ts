// builtin:markdown — renders a markdown body from a `content` binding (file /
// static) or `props.markdown` / `props.text`. Uses the package's own minimal
// allowlist sanitizer (`../markdown.js`), not an app-wide util.

import { html, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { mapMarkdownSource, type DashboardWidget } from "@boardstate/core";
import { toSanitizedMarkdownHtml } from "../markdown.js";
import { t } from "../strings.js";

export function renderMarkdown(widget: DashboardWidget, value: unknown): TemplateResult {
  const source = mapMarkdownSource(widget, value);
  if (!source.trim()) {
    return html`<div class="dashboard-widget__placeholder">
      ${t("dashboard.widget.markdownEmpty")}
    </div>`;
  }
  return html`<div class="dashboard-markdown markdown-body">
    ${unsafeHTML(toSanitizedMarkdownHtml(source))}
  </div>`;
}
