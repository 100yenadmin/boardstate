// builtin:preview — the pure viewport-preset transform behind the live preview
// frame. The URL policy is shared with builtin:iframe-embed (`evaluateEmbedUrl`);
// the frame chrome (reload button, viewport switch) is a host presentation concern.

import type { DashboardWidget } from "../types.js";
import { widgetProps } from "./types.js";

/** Viewport presets constraining the frame width; desktop is unconstrained. */
export type PreviewViewport = "desktop" | "tablet" | "mobile";

const PREVIEW_VIEWPORTS: readonly PreviewViewport[] = ["desktop", "tablet", "mobile"];

/** Resolve the initial viewport from `props.defaultViewport`, defaulting to desktop. */
export function mapPreviewViewport(widget: DashboardWidget): PreviewViewport {
  const raw = widgetProps(widget).defaultViewport;
  return typeof raw === "string" && (PREVIEW_VIEWPORTS as readonly string[]).includes(raw)
    ? (raw as PreviewViewport)
    : "desktop";
}
