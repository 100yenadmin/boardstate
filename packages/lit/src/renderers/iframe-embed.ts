// builtin:iframe-embed — an embedded URL (dev-server preview, hosted report). The
// URL-policy decision (`evaluateEmbedUrl`) lives in `@boardstate/core`; the sandbox
// attribute is resolved locally (`strict` → no scripts, `scripts` → allow-scripts).

import { html, type TemplateResult } from "lit";
import { evaluateEmbedUrl, widgetProps, type DashboardWidget } from "@boardstate/core";
import { t } from "../strings.js";
import type { BuiltinWidgetContext } from "./types.js";

/** The iframe `sandbox` attribute for an embed mode. `strict` grants nothing. */
export function resolveEmbedSandbox(mode: "strict" | "scripts"): string {
  return mode === "scripts" ? "allow-scripts" : "";
}

export function renderIframeEmbed(
  widget: DashboardWidget,
  _value: unknown,
  ctx: BuiltinWidgetContext,
): TemplateResult {
  const decision = evaluateEmbedUrl(widgetProps(widget).url, {
    allowExternalEmbedUrls: ctx.embed.allowExternalEmbedUrls,
  });
  if (decision.status === "missing") {
    return html`<div class="dashboard-widget__placeholder">
      ${t("dashboard.widget.embed.missing")}
    </div>`;
  }
  if (decision.status === "blocked") {
    return html`<div class="dashboard-widget__placeholder" data-test-id="dashboard-embed-blocked">
      ${
        decision.reason === "external"
          ? t("dashboard.widget.embed.blockedExternal")
          : t("dashboard.widget.embed.blockedScheme")
      }
    </div>`;
  }
  return html`<iframe
    class="dashboard-embed__frame"
    data-test-id="dashboard-embed-frame"
    src=${decision.url}
    title=${widget.title}
    sandbox=${resolveEmbedSandbox(ctx.embed.embedSandboxMode)}
    referrerpolicy="no-referrer"
    loading="lazy"
  ></iframe>`;
}
