// Data-shape mapping tests for the builtin widget transforms: each `map*`/
// `evaluate*` turns an RPC payload fixture into the rendered view model. DOM-free
// — the presentation rendering is exercised in a host presentation package.

import { describe, expect, it } from "vitest";
import type { DashboardWidget, DashboardWorkspace } from "../types.js";
import {
  buildActionFormPrompt,
  coerceFieldValue,
  mapActionForm,
  type ActionFormModel,
} from "./action-form.js";
import { mapActivity } from "./activity.js";
import { mapAgentStatus } from "./agent-status.js";
import {
  buildApprovalsSource,
  buildWidgetApprovalsSource,
  mapApprovals,
  toWidgetApprovalDecision,
} from "./approvals.js";
import { mapChart, normalizeSeries } from "./chart.js";
import { mapCron } from "./cron.js";
import { evaluateEmbedUrl } from "./iframe-embed.js";
import { mapInstances } from "./instances.js";
import { mapMarkdownSource } from "./markdown.js";
import { notesTextFromState } from "./notes.js";
import { mapPreviewViewport } from "./preview.js";
import { mapSessions } from "./sessions.js";
import { mapStatCard } from "./stat-card.js";
import { mapTable } from "./table.js";
import { mapUsage } from "./usage.js";

function widget(overrides: Partial<DashboardWidget> = {}): DashboardWidget {
  return {
    id: "w1",
    kind: "builtin:stat-card",
    title: "Widget",
    grid: { x: 0, y: 0, w: 4, h: 2 },
    collapsed: false,
    ...overrides,
  };
}

describe("stat-card mapping", () => {
  it("selects a metric from a structured usage.cost payload", () => {
    const model = mapStatCard(
      widget({ title: "Cost Today", props: { metric: "todayCost", format: "usd" } }),
      { totals: { totalCost: 12.5, totalTokens: 4000 } },
    );
    expect(model.display).toBe("$12.50");
  });

  it("formats integer token counts", () => {
    const model = mapStatCard(widget({ props: { metric: "todayTokens", format: "int" } }), {
      totals: { totalTokens: 1234567 },
    });
    expect(model.display).toBe("1,234,567");
  });

  it("drops the inner label when it repeats the widget title", () => {
    expect(
      mapStatCard(widget({ title: "Revenue", props: { label: "Revenue" } }), 1).label,
    ).toBeNull();
    expect(mapStatCard(widget({ title: "Revenue", props: { label: "Q3" } }), 1).label).toBe("Q3");
  });

  it("falls back to props.value and yields null for missing data", () => {
    expect(mapStatCard(widget({ props: { value: 5, format: "raw" } }), undefined).display).toBe(
      "5",
    );
    expect(mapStatCard(widget(), undefined).display).toBeNull();
  });
});

describe("markdown mapping", () => {
  it("prefers the binding value, then props.markdown/text", () => {
    expect(mapMarkdownSource(widget(), "# from binding")).toBe("# from binding");
    expect(mapMarkdownSource(widget({ props: { markdown: "# props" } }), undefined)).toBe(
      "# props",
    );
    expect(mapMarkdownSource(widget({ props: { text: "plain" } }), undefined)).toBe("plain");
  });
});

describe("table mapping", () => {
  const rows = [
    { name: "a", cost: 1 },
    { name: "b", cost: 2 },
    { name: "c", cost: 3 },
  ];

  it("derives columns from the first row and limits rows with a footer count", () => {
    const model = mapTable(widget({ props: { limit: 2 } }), rows);
    expect(model.columns).toEqual(["name", "cost"]);
    expect(model.shown).toBe(2);
    expect(model.total).toBe(3);
  });

  it("honors an explicit columns picklist", () => {
    const model = mapTable(widget({ props: { columns: ["cost"] } }), rows);
    expect(model.columns).toEqual(["cost"]);
  });
});

describe("sessions mapping", () => {
  it("maps sessions.list rows with a live-run flag", () => {
    const model = mapSessions(widget(), {
      sessions: [
        { key: "main:1", displayName: "One", hasActiveRun: true, updatedAt: 1000 },
        { key: "main:2", label: "Two", status: "idle", updatedAt: 2000 },
        { key: "" }, // dropped: no key
      ],
    });
    expect(model.rows.map((r) => r.key)).toEqual(["main:1", "main:2"]);
    expect(model.rows[0]!.active).toBe(true);
    expect(model.rows[1]!.active).toBe(false);
  });
});

describe("usage mapping", () => {
  it("reads today cost + tokens from usage.cost totals", () => {
    const model = mapUsage(widget(), { totals: { totalCost: 3.2, totalTokens: 999 }, days: 1 });
    expect(model.cost).toBe(3.2);
    expect(model.tokens).toBe(999);
    expect(model.days).toBe(1);
  });

  it("defaults to zero on an empty payload", () => {
    const model = mapUsage(widget(), {});
    expect(model.cost).toBe(0);
    expect(model.tokens).toBe(0);
  });
});

describe("cron mapping", () => {
  it("maps cron.list jobs to next-run + last-status", () => {
    const model = mapCron(widget(), {
      jobs: [
        {
          id: "j1",
          name: "Nightly",
          enabled: true,
          state: { nextRunAtMs: 5000, lastRunStatus: "ok" },
        },
        { id: "j2", name: "Off", enabled: false, state: { lastStatus: "error" } },
      ],
    });
    expect(model.jobs[0]).toMatchObject({ id: "j1", nextRunAtMs: 5000, lastStatus: "ok" });
    expect(model.jobs[1]).toMatchObject({ id: "j2", enabled: false, lastStatus: "error" });
  });
});

describe("instances mapping", () => {
  it("maps system-presence entries to health dots", () => {
    const model = mapInstances(widget(), [
      { instanceId: "gw-1", mode: "gateway", lastInputSeconds: 5 },
      { host: "node-2", lastInputSeconds: 600 },
      {}, // dropped: no id
    ]);
    expect(model.instances).toHaveLength(2);
    expect(model.instances[0]).toMatchObject({ id: "gw-1", healthy: true });
    expect(model.instances[1]).toMatchObject({ id: "node-2", healthy: false });
  });
});

describe("activity mapping", () => {
  it("maps cron.runs entries to a compact feed", () => {
    const model = mapActivity(widget(), {
      entries: [
        { ts: 1000, jobName: "Nightly", status: "ok", summary: "done" },
        { ts: 2000, jobId: "j2", status: "error", error: "boom" },
      ],
    });
    expect(model.entries[0]).toMatchObject({ title: "Nightly", status: "ok", detail: "done" });
    expect(model.entries[1]).toMatchObject({ title: "j2", status: "error", detail: "boom" });
  });
});

describe("iframe-embed URL policy", () => {
  const origin = "https://control.example";

  it("allows internal (same-origin / relative) URLs regardless of external policy", () => {
    expect(evaluateEmbedUrl("/report", { allowExternalEmbedUrls: false }, origin)).toEqual({
      status: "ok",
      url: "/report",
      external: false,
    });
    expect(
      evaluateEmbedUrl("https://control.example/x", { allowExternalEmbedUrls: false }, origin),
    ).toMatchObject({ status: "ok", external: false });
  });

  it("blocks external http(s) URLs unless allowExternalEmbedUrls", () => {
    expect(
      evaluateEmbedUrl("https://evil.example", { allowExternalEmbedUrls: false }, origin),
    ).toEqual({ status: "blocked", reason: "external", url: "https://evil.example" });
    expect(
      evaluateEmbedUrl("https://evil.example", { allowExternalEmbedUrls: true }, origin),
    ).toMatchObject({ status: "ok", external: true });
  });

  it("rejects non-http(s) schemes outright", () => {
    expect(
      evaluateEmbedUrl("javascript:alert(1)", { allowExternalEmbedUrls: true }, origin),
    ).toMatchObject({ status: "blocked", reason: "scheme" });
    expect(
      evaluateEmbedUrl("data:text/html,x", { allowExternalEmbedUrls: true }, origin),
    ).toMatchObject({ status: "blocked", reason: "scheme" });
  });

  it("reports missing when no url is set", () => {
    expect(evaluateEmbedUrl(undefined, { allowExternalEmbedUrls: true }, origin)).toEqual({
      status: "missing",
    });
  });
});

describe("chart mapping", () => {
  it("normalizes the tolerant value shapes to a plain number[]", () => {
    expect(normalizeSeries([1, 2, 3])).toEqual([1, 2, 3]);
    expect(normalizeSeries([{ y: 4 }, { value: 5 }, { x: 9, y: 6 }])).toEqual([4, 5, 6]);
    expect(normalizeSeries({ points: [1, { value: 2 }] })).toEqual([1, 2]);
    expect(normalizeSeries([1, "bad", null, { z: 3 }, 2])).toEqual([1, 2]);
    expect(normalizeSeries(undefined)).toEqual([]);
  });

  it("defaults to a line chart and derives the value range", () => {
    const model = mapChart(widget(), [3, 1, 5]);
    expect(model.type).toBe("line");
    expect(model.min).toBe(1);
    expect(model.max).toBe(5);
  });

  it("honors a valid props.type and falls back on an unknown one", () => {
    expect(mapChart(widget({ props: { type: "bar" } }), [1, 2]).type).toBe("bar");
    expect(mapChart(widget({ props: { type: "pie" } }), [1, 2]).type).toBe("line");
  });
});

describe("notes state<->text", () => {
  it("reads the raw string blob, collapsing non-strings to empty", () => {
    expect(notesTextFromState("hello")).toBe("hello");
    expect(notesTextFromState(null)).toBe("");
    expect(notesTextFromState({ note: "x" })).toBe("");
  });
});

describe("action-form interpolation + caps", () => {
  const textField = (name: string, extra: Partial<ActionFormModel["fields"][number]> = {}) => ({
    name,
    label: name,
    type: "text" as const,
    ...extra,
  });
  const model = (over: Partial<ActionFormModel> = {}): ActionFormModel => ({
    template: "{a}",
    fields: [textField("a")],
    buttonLabel: null,
    ...over,
  });

  it("fills only declared slots and leaves undeclared slots literal", () => {
    expect(
      buildActionFormPrompt(model({ template: "{a} then {b}" }), { a: "run", b: "ignored" }),
    ).toBe("run then {b}");
  });

  it("never double-expands: a value containing a declared slot stays literal", () => {
    const m = model({ template: "{a}", fields: [textField("a"), textField("evil")] });
    expect(buildActionFormPrompt(m, { a: "{evil}", evil: "PWNED" })).toBe("{evil}");
  });

  it("enforces the per-field length cap and the 200-char default", () => {
    expect(
      buildActionFormPrompt(model({ fields: [textField("a", { maxLength: 3 })] }), { a: "abcdef" }),
    ).toBe("abc");
    expect(buildActionFormPrompt(model(), { a: "x".repeat(500) }).length).toBe(200);
  });

  it("coerces number and select values, collapsing invalid input to empty", () => {
    expect(coerceFieldValue({ name: "n", label: "N", type: "number" }, "42")).toBe("42");
    expect(coerceFieldValue({ name: "n", label: "N", type: "number" }, "not-a-number")).toBe("");
    const select = { name: "s", label: "S", type: "select" as const, options: ["a", "b"] };
    expect(coerceFieldValue(select, "a")).toBe("a");
    expect(coerceFieldValue(select, "c")).toBe("");
  });

  it("maps well-formed props and drops malformed fields", () => {
    const mapped = mapActionForm(
      widget({
        kind: "builtin:action-form",
        props: {
          template: "{a}",
          fields: [
            { name: "a", label: "A", type: "text" },
            { name: "bad", label: "B", type: "select" }, // select without options → dropped
          ],
          buttonLabel: "Go",
        },
      }),
    );
    expect(mapped.fields.map((f) => f.name)).toEqual(["a"]);
    expect(mapped.buttonLabel).toBe("Go");
  });
});

describe("preview viewport", () => {
  it("honors props.defaultViewport, defaulting to desktop for missing/invalid", () => {
    expect(mapPreviewViewport(widget({ props: { defaultViewport: "mobile" } }))).toBe("mobile");
    expect(mapPreviewViewport(widget({ props: { defaultViewport: "bogus" } }))).toBe("desktop");
    expect(mapPreviewViewport(widget())).toBe("desktop");
  });
});

describe("agent-status mapping", () => {
  it("reuses sessions.list rows for busy/idle + objective + budget progress", () => {
    const model = mapAgentStatus(widget(), {
      sessions: [
        {
          key: "main:1",
          displayName: "Builder",
          hasActiveRun: true,
          goal: { objective: "Ship the widget", tokensUsed: 50, tokenBudget: 200 },
        },
        { key: "main:2", label: "Idler", status: "done" },
        { key: "" }, // dropped: no key
      ],
    });
    expect(model.rows.map((r) => r.key)).toEqual(["main:1", "main:2"]);
    expect(model.rows[0]).toMatchObject({ active: true, task: "Ship the widget", progress: 0.25 });
    expect(model.rows[1]).toMatchObject({ active: false, task: null, progress: null });
    expect(model.activeCount).toBe(1);
    expect(model.total).toBe(2);
  });
});

describe("approvals mapping", () => {
  function workspace(registry: DashboardWorkspace["widgetsRegistry"] = {}): DashboardWorkspace {
    return {
      schemaVersion: 1,
      workspaceVersion: 1,
      capabilitiesRegistry: {},
      tabs: [],
      prefs: { tabOrder: [] },
      widgetsRegistry: registry,
    };
  }

  it("derives only pending widget approvals from the registry, with agent provenance", () => {
    const source = buildWidgetApprovalsSource(
      workspace({
        chart: { status: "pending", createdBy: "agent:main" },
        notes: { status: "approved", createdBy: "agent:main" },
        old: { status: "rejected" },
      }),
      () => {},
    );
    expect(source.pending).toEqual([
      { id: "chart", kind: "widget", title: "chart", requestedBy: "main" },
    ]);
  });

  it("combines pending widget approvals and requested capabilities, routing each decision", () => {
    const ws = workspace({ chart: { status: "pending", createdBy: "agent:main" } });
    ws.capabilitiesRegistry = {
      "postgres-metrics": {
        status: "requested",
        methods: ["usage.cost", "sessions.list"],
        streams: ["presence"],
        description: "prod metrics",
      },
      "already-granted": { status: "granted", methods: ["health"], streams: [] },
    };
    const widgetCalls: Array<[string, string]> = [];
    const capCalls: Array<[string, string]> = [];
    const source = buildApprovalsSource(
      ws,
      (name, decision) => widgetCalls.push([name, decision]),
      (name, decision) => capCalls.push([name, decision]),
    );
    // Capability requests come first; granted ones are omitted.
    expect(source.pending.map((item) => [item.kind, item.id])).toEqual([
      ["capability", "postgres-metrics"],
      ["widget", "chart"],
    ]);
    expect(source.pending[0]!.detail).toBe("prod metrics");

    source.onDecide(source.pending[0]!, "approve");
    source.onDecide(source.pending[1]!, "reject");
    expect(capCalls).toEqual([["postgres-metrics", "granted"]]);
    expect(widgetCalls).toEqual([["chart", "rejected"]]);
  });

  it("renders a tools-only capability grant without throwing (methods/streams empty)", () => {
    // SPEC §17 v2: a grant may authorize external tools with NO data reads/streams.
    // The reach summary reads grant.methods.length / grant.streams.length — a
    // tools-only grant normalizes both to [] so `.length` never throws.
    const ws = workspace();
    ws.capabilitiesRegistry = {
      "office-tools": {
        status: "requested",
        methods: [],
        streams: [],
        tools: ["officecli:send_mail"],
      },
    };
    const source = buildApprovalsSource(
      ws,
      () => {},
      () => {},
    );
    expect(source.pending.map((item) => [item.kind, item.id])).toEqual([
      ["capability", "office-tools"],
    ]);
    expect(source.pending[0]!.detail).toBe("wants 1 tool");
  });

  it("maps decisions to the registry vocabulary and limits the row count", () => {
    expect(toWidgetApprovalDecision("approve")).toBe("approved");
    expect(toWidgetApprovalDecision("reject")).toBe("rejected");
    const source = buildWidgetApprovalsSource(
      workspace({
        a: { status: "pending" },
        b: { status: "pending" },
        c: { status: "pending" },
      }),
      () => {},
    );
    const model = mapApprovals(widget({ props: { limit: 2 } }), source);
    expect(model.total).toBe(3);
    expect(model.items).toHaveLength(2);
  });

  it("routes onDecide through the resolver with the mapped decision", () => {
    const calls: Array<[string, string]> = [];
    const source = buildWidgetApprovalsSource(
      workspace({ chart: { status: "pending", createdBy: "agent:main" } }),
      (name, decision) => calls.push([name, decision]),
    );
    source.onDecide(source.pending[0]!, "approve");
    source.onDecide(source.pending[0]!, "reject");
    expect(calls).toEqual([
      ["chart", "approved"],
      ["chart", "rejected"],
    ]);
  });
});
