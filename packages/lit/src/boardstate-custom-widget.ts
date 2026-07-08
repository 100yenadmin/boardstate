// Sandboxed host for approved custom widgets (SPEC §UI side). Renders the
// `<iframe sandbox="allow-scripts">` and wires the parent side of the postMessage
// bridge via `@boardstate/host`'s `mountCustomWidget` (which owns the opaque-origin
// post + identity accept filter). Rendering the iframe element is this package's
// job; the security-critical bridge wiring is not re-implemented here.
//
// SECURITY INVARIANTS (enforced by @boardstate/host + this element):
// - The sandbox attribute is the CONSTANT string "allow-scripts" (never config).
// - `referrerpolicy="no-referrer"`.
// - Parent accepts a message ONLY when `event.source === iframe.contentWindow`
//   (host's mount owns this identity filter; opaque origins are never compared).

import { html, type TemplateResult } from "lit";
import { AsyncDirective } from "lit/async-directive.js";
import { directive } from "lit/directive.js";
import {
  isRpcMethodAllowed,
  isStreamEventAllowed,
  mountCustomWidget,
  readThemeTokensFromRoot,
  resolveBinding as resolveDashboardBinding,
  widgetAssetUrl,
  type ClientBinding,
} from "@boardstate/host";
import type {
  DashboardBinding,
  DashboardWidget,
  Transport,
  WidgetManifestView,
} from "@boardstate/core";

export type CustomWidgetHostContext = {
  transport: Transport | null;
  /** HTTP base path for widget assets; "" for same-origin root. */
  basePath: string;
  /** Session key for prompt dispatch via chat.send. */
  sessionKey: string;
  /** Operator confirm dialog quoting the prompt text; resolves true to send. */
  confirmPrompt?: (text: string) => Promise<boolean> | boolean;
  /** Read theme tokens; defaults to computed styles of the document root. */
  readThemeTokens?: () => Record<string, string>;
};

function bindingByManifestId(widget: DashboardWidget, bindingId: string): DashboardBinding | null {
  return widget.bindings?.[bindingId] ?? null;
}

/**
 * Wire the parent bridge for one iframe: manifest gating, binding resolution over
 * the injected transport, theme tokens, and prompt dispatch. Returns the teardown.
 */
function attachWidgetBridge(params: {
  iframe: HTMLIFrameElement;
  widget: DashboardWidget;
  manifest: WidgetManifestView;
  context: CustomWidgetHostContext;
}): () => void {
  const { iframe, widget, manifest, context } = params;
  return mountCustomWidget(iframe, {
    manifest,
    assertBindingAllowed: (bindingId) => {
      // Resolve-time defense-in-depth: an rpc binding may only name an allowlisted
      // method; a stream binding only an allowlisted event. Denials skip the gateway.
      const binding = bindingByManifestId(widget, bindingId) as ClientBinding | null;
      if (binding?.source === "rpc" && !isRpcMethodAllowed(binding.method ?? "")) {
        return "binding_denied";
      }
      if (binding?.source === "stream" && !isStreamEventAllowed(binding.event ?? "")) {
        return "binding_denied";
      }
      return null;
    },
    resolveBinding: async (bindingId) => {
      const binding = bindingByManifestId(widget, bindingId) as ClientBinding | null;
      if (!binding) {
        throw new Error(`binding not configured: ${bindingId}`);
      }
      const result = await resolveDashboardBinding(context.transport, binding);
      if ("error" in result) {
        throw new Error(result.error);
      }
      return result.value;
    },
    resolveTheme: context.readThemeTokens ?? readThemeTokensFromRoot,
    confirmPrompt: async (text) => {
      if (context.confirmPrompt) {
        return await context.confirmPrompt(text);
      }
      return typeof window !== "undefined" ? window.confirm(text) : false;
    },
    sendPrompt: async (text) => {
      if (!context.transport) {
        throw new Error("Not connected.");
      }
      await context.transport.request("chat.send", {
        sessionKey: context.sessionKey,
        message: text,
        deliver: false,
      });
    },
  });
}

/**
 * Lit directive owning the iframe's lifecycle: it constructs the sandboxed iframe
 * once, attaches the bridge, and tears both down on disconnect. A directive (rather
 * than re-rendering an `<iframe>` template) keeps the frame from being recreated on
 * every parent render, which would drop bridge state and reload the widget.
 */
class CustomWidgetFrameDirective extends AsyncDirective {
  private iframe: HTMLIFrameElement | null = null;
  private detach: (() => void) | null = null;
  private key = "";

  render(params: {
    widget: DashboardWidget;
    manifest: WidgetManifestView;
    context: CustomWidgetHostContext;
  }): HTMLIFrameElement {
    const name = params.widget.kind.slice("custom:".length);
    const src = widgetAssetUrl(params.context.basePath, name, "index.html");
    const nextKey = `${params.widget.id}::${src}`;
    if (this.iframe && this.key === nextKey) {
      return this.iframe;
    }
    this.detach?.();
    const iframe = document.createElement("iframe");
    // CONSTANT sandbox — do not templatize. Only script execution is granted.
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.setAttribute("loading", "lazy");
    iframe.className = "dashboard-widget__frame";
    iframe.title = params.widget.title;
    iframe.src = src;
    iframe.setAttribute("data-test-id", "boardstate-custom-widget-frame");
    this.detach = attachWidgetBridge({
      iframe,
      widget: params.widget,
      manifest: params.manifest,
      context: params.context,
    });
    this.iframe = iframe;
    this.key = nextKey;
    return iframe;
  }

  override disconnected(): void {
    this.detach?.();
    this.detach = null;
    this.iframe = null;
    this.key = "";
  }
}

const customWidgetFrame = directive(CustomWidgetFrameDirective);

/** Renders the sandboxed iframe host for an approved custom widget. */
export function renderCustomWidgetHost(params: {
  widget: DashboardWidget;
  manifest: WidgetManifestView;
  context: CustomWidgetHostContext;
}): TemplateResult {
  return html`<div class="dashboard-widget__custom" data-test-id="boardstate-custom-widget">
    ${customWidgetFrame(params)}
  </div>`;
}
