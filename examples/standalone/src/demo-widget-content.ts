// Constants for the ONE custom widget the "simulate agent" script adds.
//
// A real host writes a scaffolded widget's files to disk (@boardstate/server's
// scaffoldDashboardWidget) and serves them over HTTP (serve.ts, SPEC §9). This
// standalone example has no server process, so the same two files live as static
// assets under public/widgets/agent-insight-card/ — Vite (and any static host,
// e.g. GitHub Pages) serves them at the exact `/widgets/<name>/<file>` paths
// `@boardstate/lit`'s unmodified custom-widget host requests (widgetAssetUrl).
// That includes the sandboxed iframe's own document navigation, which a Service
// Worker cannot intercept for an opaque-origin frame — static files can.
//
// The values below must stay in sync with public/widgets/agent-insight-card/.

export const DEMO_WIDGET_NAME = "agent-insight-card";
export const DEMO_WIDGET_TITLE = "Agent Insight Card";
export const DEMO_WIDGET_BINDING_ID = "value";

export type DemoWidgetValue = { headline: string; detail: string; count: number };

export const DEMO_WIDGET_VALUE: DemoWidgetValue = {
  headline: "Sandboxed & approved",
  detail:
    "An agent scaffolded this widget and it only started rendering the moment you clicked Approve.",
  count: 1,
};
