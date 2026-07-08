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
  createWidgetStateAccessor,
  isRpcMethodAllowed,
  isStreamEventAllowed,
  mountCustomWidget,
  readThemeTokensFromRoot,
  resolveBinding as resolveDashboardBinding,
  widgetAssetUrl,
  type ClientBinding,
} from "@boardstate/host";
import {
  nextSubscriberId,
  publish as busPublish,
  subscribe as busSubscribe,
  unsubscribeAll as busUnsubscribeAll,
  type DashboardBinding,
  type DashboardWidget,
  type Transport,
  type WidgetManifestView,
} from "@boardstate/core";

export type CustomWidgetHostContext = {
  transport: Transport | null;
  /** HTTP base path for widget assets; "" for same-origin root. */
  basePath: string;
  /** Session key for prompt dispatch via chat.send. */
  sessionKey: string;
  /**
   * Slug of the tab this widget belongs to. The pub/sub broker keys delivery off
   * this HOST-tracked value (never anything in a child message), so a widget can
   * only ever reach same-tab peers and cannot spoof its way onto another tab.
   * Defaults to a single implicit tab when the host omits it.
   */
  tabSlug?: string;
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
  // Pub/sub identity is minted and tracked HERE, in the trusted parent: the tab
  // slug comes from the host context and the subscriber id is a fresh opaque token
  // the child never sees. Every broker call closes over these, so a child message
  // can only carry an (opaque) channel + payload and can never address a tab or a
  // peer it was not assigned to.
  const tabSlug = context.tabSlug ?? "";
  const subscriberId = nextSubscriberId();
  const dispose = mountCustomWidget(iframe, {
    manifest,
    bus: {
      publish: (channel, payload) =>
        busPublish({ tabSlug, channel, fromSubscriberId: subscriberId, payload }),
      subscribe: (channel, deliver) => busSubscribe({ tabSlug, channel, subscriberId, deliver }),
    },
    // Widget write-back: the parent persists state under the widget's OWN tracked id
    // (`widget.id`, host-tracked) via the shared accessor — the widgetId is never
    // taken from a child message, so a widget can only read/write its own state.
    // Gated behind the manifest `state:persist` capability inside the bridge.
    getWidgetState: async () => {
      if (!context.transport) {
        throw new Error("Not connected.");
      }
      return createWidgetStateAccessor(context.transport, widget.id).get();
    },
    setWidgetState: async (blob) => {
      if (!context.transport) {
        throw new Error("Not connected.");
      }
      return createWidgetStateAccessor(context.transport, widget.id).set(blob);
    },
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
  return () => {
    dispose();
    // Belt-and-suspenders: the bridge's dispose already unsubscribes every channel
    // this widget held; sweep the broker by (tab, subscriberId) too so an unmounted
    // widget can never leave a dangling delivery behind.
    busUnsubscribeAll(tabSlug, subscriberId);
  };
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
