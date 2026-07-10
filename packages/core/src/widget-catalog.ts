// The builtin-widget catalog: for each `builtin:*` kind, its one-line purpose, the
// binding keys it reads (with the EXACT value shape), its props, and a copy-pasteable
// valid `example` widget. This is the single source of truth behind the
// `dashboard_widget_catalog` agent tool (SPEC §4) — an agent reads it BEFORE composing
// so it doesn't guess prop/binding shapes. The prose composition guide summarizes the
// same facts; this carries the machine-checkable examples.
//
// Why examples matter: the common first-run failure is putting data in `props` instead
// of `bindings.<key>` with a `{ source: "static", value: … }` envelope — and guessing
// the wrong binding key (a `table` binds `rows`, a `markdown` binds `content`, NOT
// `value`). Every `example` here is validated against the schema in a unit test, so a
// copied example always mounts non-empty.

// The examples type against the SCHEMA's widget shape (it carries `hidden`, which the
// write-path validator requires); core's own read-model widget type is narrower.
import type { DashboardWidget } from "@boardstate/schema";

export type WidgetCatalogBinding = {
  /** Binding key on `widget.bindings` (e.g. "value", "rows", "content"). */
  key: string;
  /** The resolved value shape the widget expects. */
  shape: string;
};

export type WidgetCatalogEntry = {
  /** The `builtin:<name>` kind. */
  kind: string;
  /** One line: what this widget is for. */
  summary: string;
  /** Binding keys the widget reads (empty for widgets that ignore bindings). */
  bindings: WidgetCatalogBinding[];
  /** Props the widget honors, key → short description. */
  props: Record<string, string>;
  /** A complete, schema-valid widget object an agent can copy and adapt. */
  example: DashboardWidget;
  /**
   * Extra copy-pasteable variants for a widget with more than one mode (e.g. an
   * action-form's `tool` mode alongside the default `prompt` example). Each is
   * schema-valid — the honesty-gate test validates these exactly like `example`.
   */
  examples?: DashboardWidget[];
};

/** A small grid rect helper so the examples read uniformly. */
function grid(x: number, y: number, w: number, h: number) {
  return { x, y, w, h };
}

export const WIDGET_CATALOG: readonly WidgetCatalogEntry[] = [
  {
    kind: "builtin:stat-card",
    summary: "One number that matters — a KPI with a label.",
    bindings: [{ key: "value", shape: "number | string, or a structured payload + props.metric" }],
    props: {
      format: '"usd" | "int" | "percent" | "raw" (how the number renders)',
      metric: "when the binding resolves an object, the field name to display",
      label: "inner label (omit if it would just repeat the title)",
    },
    example: {
      id: "mrr",
      kind: "builtin:stat-card",
      title: "MRR",
      grid: grid(0, 0, 3, 2),
      collapsed: false,
      hidden: false,
      bindings: { value: { source: "static", value: 128400 } },
      props: { format: "usd", label: "Monthly recurring revenue" },
    },
  },
  {
    kind: "builtin:chart",
    summary: "Trends, comparisons, budgets — a small inline chart.",
    bindings: [{ key: "value", shape: "number[] (or labeled points {label,value}[])" }],
    props: {
      type: '"line" | "bar" | "area" | "sparkline" | "gauge" (default line)',
      detail: "true adds labeled axes, gridlines, and value tooltips (line/bar/area)",
      label: "sparkline only: true shows the trailing value as an end label",
    },
    example: {
      id: "revenue-trend",
      kind: "builtin:chart",
      title: "Revenue (14d)",
      grid: grid(0, 2, 8, 5),
      collapsed: false,
      hidden: false,
      bindings: { value: { source: "static", value: [8, 12, 10, 18, 24, 21, 30, 35, 41, 52] } },
      props: { type: "area" },
    },
    examples: [
      {
        id: "signups-spark",
        kind: "builtin:chart",
        title: "Signups",
        grid: grid(0, 7, 3, 2),
        collapsed: false,
        hidden: false,
        bindings: { value: { source: "static", value: [12, 9, 14, 11, 17, 15, 22] } },
        props: { type: "sparkline", label: true },
      },
      {
        id: "latency-detail",
        kind: "builtin:chart",
        title: "p95 latency (ms)",
        grid: grid(0, 9, 8, 5),
        collapsed: false,
        hidden: false,
        bindings: { value: { source: "static", value: [180, 220, 190, 240, 210, 260, 230] } },
        props: { type: "line", detail: true },
      },
    ],
  },
  {
    kind: "builtin:table",
    summary: "Rows and columns — a compact table (keep ~10 visible rows).",
    bindings: [{ key: "rows", shape: "Array<Record<string, unknown>> — NOT `value`" }],
    props: {
      columns: "string[] of keys to show (defaults to the first row's keys)",
      limit: "max visible rows before a “+N more” count",
    },
    example: {
      id: "recent-runs",
      kind: "builtin:table",
      title: "Recent runs",
      grid: grid(0, 7, 8, 4),
      collapsed: false,
      hidden: false,
      bindings: {
        rows: {
          source: "static",
          value: [
            { agent: "finance", task: "Q3 rollup", status: "done" },
            { agent: "ops", task: "Log sweep", status: "running" },
          ],
        },
      },
      props: { columns: ["agent", "task", "status"] },
    },
  },
  {
    kind: "builtin:markdown",
    summary: "Prose, explanations, small markdown tables (sanitized).",
    bindings: [{ key: "content", shape: "markdown string — NOT `value`" }],
    props: {
      markdown: "inline markdown source (used when there is no `content` binding)",
      text: "alias for `markdown`",
    },
    example: {
      id: "summary",
      kind: "builtin:markdown",
      title: "Summary",
      grid: grid(8, 2, 4, 5),
      collapsed: false,
      hidden: false,
      props: { markdown: "## Insights\n\n- Signal up **6.5×** across 14 days.\n- Momentum late." },
    },
  },
  {
    kind: "builtin:notes",
    summary: "Operator scratch text (persisted via widget state).",
    bindings: [],
    props: { text: "starter content" },
    example: {
      id: "scratchpad",
      kind: "builtin:notes",
      title: "Notes",
      grid: grid(8, 7, 4, 4),
      collapsed: false,
      hidden: false,
      props: { text: "Jot findings here…" },
    },
  },
  {
    kind: "builtin:activity",
    summary: "An event feed — recent things that happened.",
    bindings: [{ key: "value", shape: "{ entries: [{ ts, jobName, status, summary }] }" }],
    props: { limit: "max entries shown" },
    example: {
      id: "agent-events",
      kind: "builtin:activity",
      title: "Agent events",
      grid: grid(0, 11, 6, 4),
      collapsed: false,
      hidden: false,
      bindings: {
        value: {
          source: "static",
          value: {
            entries: [
              { ts: 1783600000000, jobName: "finance", status: "ok", summary: "Rollup posted" },
            ],
          },
        },
      },
    },
  },
  {
    kind: "builtin:action-form",
    summary: "The chat↔dashboard loop — a form that submits through the control plane.",
    bindings: [],
    props: {
      template: "the message sent on submit; `{{fieldName}}` interpolates a field (single pass)",
      fields: 'array of { name, label, type: "text"|"number"|"select", options?, maxLength? }',
      buttonLabel: "the submit button text (optional)",
      mode: '"prompt" (default: submit the template to the agent) or "tool" (invoke a granted external tool)',
      connector: "tool mode only: the granted connector name (SPEC §17 v2)",
      tool: "tool mode only: the tool to invoke on that connector",
      argsFrom: "tool mode only: map of tool-arg name → declared field name",
    },
    example: {
      id: "ask-agent",
      kind: "builtin:action-form",
      title: "Ask the agent",
      grid: grid(0, 0, 4, 3),
      collapsed: false,
      hidden: false,
      props: {
        template: "Summarize {{topic}} for the board.",
        fields: [{ name: "topic", label: "Topic", type: "text" }],
        buttonLabel: "Ask",
      },
    },
    examples: [
      {
        id: "file-ticket",
        kind: "builtin:action-form",
        title: "File a ticket",
        grid: grid(0, 0, 4, 4),
        collapsed: false,
        hidden: false,
        props: {
          mode: "tool",
          connector: "linear",
          tool: "create_issue",
          template: "Create issue: {title}",
          fields: [
            { name: "title", label: "Title", type: "text", maxLength: 120 },
            {
              name: "priority",
              label: "Priority",
              type: "select",
              options: ["low", "med", "high"],
            },
          ],
          argsFrom: { title: "title", priority: "priority" },
          buttonLabel: "Create",
        },
      },
    ],
  },
  {
    kind: "builtin:action-button",
    summary: "One click → invoke a granted external tool with fixed args (operator-confirmed).",
    bindings: [],
    props: {
      connector: "the granted connector name (SPEC §17 v2)",
      tool: "the tool to invoke on that connector",
      args: "fixed argument object passed on click (optional)",
      label: "button text (optional)",
    },
    example: {
      id: "restart-worker",
      kind: "builtin:action-button",
      title: "Restart worker",
      grid: grid(0, 0, 3, 2),
      collapsed: false,
      hidden: false,
      props: {
        connector: "officecli",
        tool: "restart_service",
        args: { service: "worker" },
        label: "Restart",
      },
    },
  },
  {
    kind: "builtin:chat",
    summary: "Talk to the agent and watch it work (ignores bindings).",
    bindings: [],
    props: { placeholder: "empty-input hint text" },
    example: {
      id: "assistant",
      kind: "builtin:chat",
      title: "Assistant",
      grid: grid(0, 0, 6, 8),
      collapsed: false,
      hidden: false,
      props: { placeholder: "Ask me to build a view…" },
    },
  },
];

/**
 * Data-source builtins: these render a fixed shape fed by an allowlisted `rpc` read
 * method or a `stream` binding a host wires up (not typically hand-authored with static
 * data). Listed by kind + the value shape they consume; a host that has the connector
 * binds them, e.g. `{ source: "rpc", method: "usage.cost" }`.
 */
export const DATA_SOURCE_WIDGET_KINDS: ReadonlyArray<{
  kind: string;
  summary: string;
  valueShape: string;
}> = [
  {
    kind: "builtin:sessions",
    summary: "Who/what is running.",
    valueShape: "rows { key, label, status, hasActiveRun, updatedAt }; props.limit",
  },
  {
    kind: "builtin:agent-status",
    summary: "Agents + goals/progress.",
    valueShape: "sessions shape + goal { objective, tokensUsed, tokenBudget }",
  },
  {
    kind: "builtin:usage",
    summary: "Cost/token totals.",
    valueShape: "{ totals: { totalCost, totalTokens }, days? }",
  },
  {
    kind: "builtin:cron",
    summary: "Scheduled jobs.",
    valueShape: "{ jobs: [{ id, name, enabled, state: { nextRunAtMs, lastRunStatus } }] }",
  },
  {
    kind: "builtin:instances",
    summary: "Fleet presence.",
    valueShape: "{ presence: [{ instanceId, platform, version, lastInputSeconds }] }",
  },
  {
    kind: "builtin:approvals",
    summary: "Pending widget approvals (reads the live registry; ignores bindings).",
    valueShape: "none — reads the registry",
  },
  {
    kind: "builtin:preview",
    summary: "A live page preview.",
    valueShape: "props.url (same-origin ok; cross-origin needs host opt-in)",
  },
  {
    kind: "builtin:iframe-embed",
    summary: "An embedded live page.",
    valueShape: "props.url (same-origin ok; cross-origin needs host opt-in)",
  },
];

/** Every `builtin:*` kind the catalog knows (full entries + data-source kinds). */
export const WIDGET_CATALOG_KINDS: readonly string[] = [
  ...WIDGET_CATALOG.map((entry) => entry.kind),
  ...DATA_SOURCE_WIDGET_KINDS.map((entry) => entry.kind),
];
