// Data-shape mapping tests for the builtin widget transforms: each `map*`/
// `evaluate*` turns an RPC payload fixture into the rendered view model. DOM-free
// — the presentation rendering is exercised in a host presentation package.

import { describe, expect, it } from "vitest";
import type { DashboardWidget } from "../types.js";
import { mapActivity } from "./activity.js";
import { mapCron } from "./cron.js";
import { evaluateEmbedUrl } from "./iframe-embed.js";
import { mapInstances } from "./instances.js";
import { mapMarkdownSource } from "./markdown.js";
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
