// DOM host for one approved custom widget: wires the sandboxed iframe to the
// framework-free parent bridge (`bridge.ts`). This module owns the two pieces the
// bridge cannot: posting to the child (targetOrigin "*", opaque origin) and the
// `event.source === iframe.contentWindow` IDENTITY accept filter that runs BEFORE
// `bridge.handleMessage`. Rendering the iframe element itself is the caller's job
// (framework-free — no Lit here).

import type { Transport } from "@boardstate/core";
import { createWidgetBridge, type WidgetBridgeDeps, type WidgetOutboundMessage } from "./bridge.js";

// Theme tokens exposed to widgets so agent-authored UIs match the active theme
// (SPEC §7). Read from the document root's computed styles at getTheme time.
export const WIDGET_THEME_TOKENS = [
  "--bg",
  "--card",
  "--card-foreground",
  "--text",
  "--muted",
  "--border",
  "--accent",
  "--accent-foreground",
  "--radius",
  "--radius-sm",
  "--font-sans",
  "--font-mono",
] as const;

/** Read the standard widget theme tokens from the document root's computed styles. */
export function readThemeTokensFromRoot(): Record<string, string> {
  const tokens: Record<string, string> = {};
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") {
    return tokens;
  }
  const styles = getComputedStyle(document.documentElement);
  for (const token of WIDGET_THEME_TOKENS) {
    const value = styles.getPropertyValue(token).trim();
    if (value) {
      tokens[token] = value;
    }
  }
  return tokens;
}

/**
 * Widget-id-bound accessor for the write-back state store. Both methods are bound to
 * ONE widget's id — taken from the host's tracked widget, NEVER from the widget
 * itself — so a widget (custom or builtin) can only ever read/write its own state.
 * This is the single accessor factory the custom-widget bridge and stateful builtins
 * share.
 */
export type WidgetStateAccessor = {
  get(): Promise<{ state: unknown; version?: number }>;
  set(blob: unknown): Promise<{ version: number }>;
};

/**
 * Build a `widget.id`-bound state accessor over a transport. `dashboard.widget.state.get`
 * answers `{ state, version? }`; `dashboard.widget.state.set` answers `{ version }`.
 * The widgetId is closed over here (host-tracked), never read from a child message.
 */
export function createWidgetStateAccessor(
  transport: Transport,
  widgetId: string,
): WidgetStateAccessor {
  return {
    get: async () => {
      const payload = await transport.request("dashboard.widget.state.get", { widgetId });
      const record = payload as { state?: unknown; version?: number } | null;
      return {
        state: record?.state ?? null,
        ...(typeof record?.version === "number" ? { version: record.version } : {}),
      };
    },
    set: async (blob) => {
      const payload = await transport.request("dashboard.widget.state.set", {
        widgetId,
        state: blob,
      });
      const version = (payload as { version?: number } | null)?.version;
      return { version: typeof version === "number" ? version : 0 };
    },
  };
}

/**
 * Everything `mountCustomWidget` forwards to `createWidgetBridge` — all the injected
 * side effects (binding resolution, theme, prompt, state, bus) EXCEPT `post`, which
 * this module wires from the iframe's contentWindow.
 */
export type MountCustomWidgetOptions = Omit<WidgetBridgeDeps, "post">;

/**
 * Mount the parent bridge on `iframe`: post to the child with targetOrigin "*"
 * (opaque origin), install the window `message` listener whose IDENTITY accept
 * filter (`event.source === iframe.contentWindow`) runs BEFORE the bridge sees any
 * message, and wire the injected bridge deps. Returns a dispose fn that removes the
 * listener and disposes the bridge.
 */
export function mountCustomWidget(
  iframe: HTMLIFrameElement,
  options: MountCustomWidgetOptions,
): () => void {
  const post = (message: WidgetOutboundMessage): void => {
    // targetOrigin "*" is required for an opaque (sandboxed) child origin; only
    // manifest-entitled binding data / theme tokens are ever posted.
    iframe.contentWindow?.postMessage(message, "*");
  };
  const bridge = createWidgetBridge({ ...options, post });

  const onMessage = (event: MessageEvent): void => {
    // IDENTITY accept filter — never compare origin strings (opaque origin = null).
    if (event.source !== iframe.contentWindow) {
      return;
    }
    bridge.handleMessage(event.data);
  };
  const view = iframe.ownerDocument?.defaultView ?? (typeof window !== "undefined" ? window : null);
  view?.addEventListener("message", onMessage);
  return () => {
    view?.removeEventListener("message", onMessage);
    bridge.dispose();
  };
}
