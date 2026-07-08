// builtin:markdown — resolves the markdown source string from a `content` binding
// (file / static) or `props.markdown` / `props.text`. Sanitization + rendering is
// a host presentation concern; this transform only selects the source text.

import type { DashboardWidget } from "../types.js";
import { widgetProps } from "./types.js";

export function mapMarkdownSource(widget: DashboardWidget, value: unknown): string {
  const props = widgetProps(widget);
  if (typeof value === "string") {
    return value;
  }
  if (typeof props.markdown === "string") {
    return props.markdown;
  }
  if (typeof props.text === "string") {
    return props.text;
  }
  return "";
}
