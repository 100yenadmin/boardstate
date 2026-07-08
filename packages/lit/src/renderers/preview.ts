// builtin:preview — a live preview frame (dev-server / hosted report) with chrome:
// a reload button and desktop/tablet/mobile viewport presets. The URL (`props.url`)
// is embedded in the SAME sandboxed frame as builtin:iframe-embed, reusing
// `evaluateEmbedUrl` (core) + `resolveEmbedSandbox` (local) so the URL policy and
// sandbox are byte-identical — this widget never weakens the embed gate.
//
// Renderers are pure/stateless, so the reload and viewport controls act on the live
// DOM via `ref()` handles rather than component state: reload reassigns the iframe
// `src` (sandbox-agnostic), and a viewport button swaps the wrapper's preset
// modifier class. `props.defaultViewport` sets the initial preset. The
// `mapPreviewViewport` transform lives in `@boardstate/core`.

import { html, type TemplateResult } from "lit";
import { createRef, ref } from "lit/directives/ref.js";
import {
  evaluateEmbedUrl,
  mapPreviewViewport,
  widgetProps,
  type DashboardWidget,
  type PreviewViewport,
} from "@boardstate/core";
import { t } from "../strings.js";
import { resolveEmbedSandbox } from "./iframe-embed.js";
import type { BuiltinWidgetContext } from "./types.js";

const PREVIEW_VIEWPORTS: readonly PreviewViewport[] = ["desktop", "tablet", "mobile"];

// Standard breakpoint widths for the presets live in boardstate.css
// (`.dashboard-preview__frame-wrap--{tablet,mobile}`): desktop = full width,
// tablet = 768px, mobile = 375px. Applied by class, not inline, so re-renders keep
// the CSS the single source of truth.

function viewportClass(viewport: PreviewViewport): string {
  return `dashboard-preview__frame-wrap dashboard-preview__frame-wrap--${viewport}`;
}

export function renderPreview(
  widget: DashboardWidget,
  _value: unknown,
  ctx: BuiltinWidgetContext,
): TemplateResult {
  const decision = evaluateEmbedUrl(widgetProps(widget).url, {
    allowExternalEmbedUrls: ctx.embed.allowExternalEmbedUrls,
  });
  if (decision.status === "missing") {
    return html`<div class="dashboard-widget__placeholder">
      ${t("dashboard.widget.preview.missing")}
    </div>`;
  }
  if (decision.status === "blocked") {
    return html`<div class="dashboard-widget__placeholder" data-test-id="dashboard-preview-blocked">
      ${
        decision.reason === "external"
          ? t("dashboard.widget.preview.blockedExternal")
          : t("dashboard.widget.preview.blockedScheme")
      }
    </div>`;
  }

  const initialViewport = mapPreviewViewport(widget);
  const frameRef = createRef<HTMLIFrameElement>();
  const wrapRef = createRef<HTMLDivElement>();

  // Re-setting the `src` attribute to its current value forces a reload without
  // touching `contentWindow`, so it works regardless of origin or the sandbox's
  // allow-same-origin flag.
  const reload = () => {
    const frame = frameRef.value;
    if (frame) {
      const src = frame.getAttribute("src");
      if (src !== null) {
        frame.setAttribute("src", src);
      }
    }
  };

  // Swap the wrapper's preset modifier class in place (no re-render needed).
  const setViewport = (viewport: PreviewViewport) => {
    const wrap = wrapRef.value;
    if (wrap) {
      wrap.className = viewportClass(viewport);
    }
  };

  return html`<div class="dashboard-preview">
    <div class="dashboard-preview__toolbar" role="toolbar">
      <div class="dashboard-preview__viewports" role="group">
        ${PREVIEW_VIEWPORTS.map(
          (viewport) =>
            html`<button
              class="dashboard-preview__viewport"
              type="button"
              data-test-id=${`dashboard-preview-viewport-${viewport}`}
              data-viewport=${viewport}
              title=${t(`dashboard.widget.preview.viewport.${viewport}`)}
              aria-label=${t(`dashboard.widget.preview.viewport.${viewport}`)}
              @click=${() => setViewport(viewport)}
            >
              ${t(`dashboard.widget.preview.viewport.${viewport}`)}
            </button>`,
        )}
      </div>
      <button
        class="dashboard-preview__reload"
        type="button"
        data-test-id="dashboard-preview-reload"
        title=${t("dashboard.widget.preview.reload")}
        aria-label=${t("dashboard.widget.preview.reload")}
        @click=${reload}
      >
        ${t("dashboard.widget.preview.reload")}
      </button>
    </div>
    <div class=${viewportClass(initialViewport)} ${ref(wrapRef)}>
      <iframe
        class="dashboard-embed__frame dashboard-preview__frame"
        data-test-id="dashboard-preview-frame"
        ${ref(frameRef)}
        src=${decision.url}
        title=${widget.title}
        sandbox=${resolveEmbedSandbox(ctx.embed.embedSandboxMode)}
        referrerpolicy="no-referrer"
        loading="lazy"
      ></iframe>
    </div>
  </div>`;
}
