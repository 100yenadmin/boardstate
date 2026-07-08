// Registry of builtin widget renderers, consumed by the widget cell's dispatch.
// Keys are the bare kind (`builtin:<name>` with the prefix stripped). Adding a
// builtin = add a renderer module + one entry here.

import { renderActivity } from "./activity.js";
import { renderCron } from "./cron.js";
import { renderIframeEmbed } from "./iframe-embed.js";
import { renderInstances } from "./instances.js";
import { renderMarkdown } from "./markdown.js";
import { renderSessions } from "./sessions.js";
import { renderStatCard } from "./stat-card.js";
import { renderTable } from "./table.js";
import type { BuiltinWidgetRenderer } from "./types.js";
import { renderUsage } from "./usage.js";

export const BUILTIN_WIDGET_RENDERERS: Record<string, BuiltinWidgetRenderer> = {
  "stat-card": (widget, value) => renderStatCard(widget, value),
  markdown: (widget, value) => renderMarkdown(widget, value),
  table: (widget, value) => renderTable(widget, value),
  "iframe-embed": renderIframeEmbed,
  sessions: (widget, value, ctx) => renderSessions(widget, value, ctx),
  usage: (widget, value) => renderUsage(widget, value),
  cron: (widget, value) => renderCron(widget, value),
  instances: (widget, value) => renderInstances(widget, value),
  activity: (widget, value) => renderActivity(widget, value),
};

export function getBuiltinRenderer(kind: string): BuiltinWidgetRenderer | undefined {
  const name = kind.startsWith("builtin:") ? kind.slice("builtin:".length) : kind;
  return BUILTIN_WIDGET_RENDERERS[name];
}

export {
  renderActivity,
  renderCron,
  renderIframeEmbed,
  renderInstances,
  renderMarkdown,
  renderSessions,
  renderStatCard,
  renderTable,
  renderUsage,
};
export type { BuiltinWidgetContext, BuiltinWidgetRenderer } from "./types.js";
