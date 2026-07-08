// Render assertions for the builtin widgets: the empty/populated/blocked
// affordances. The data-shape `map*` transforms are unit-tested in
// `@boardstate/core`; here we lock the DOM each renderer emits. Imports of the
// transforms come from core; the render fns are the package's own.

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import {
  evaluateEmbedUrl,
  mapActivity,
  mapCron,
  mapInstances,
  mapSessions,
  mapStatCard,
  mapTable,
  mapUsage,
  type DashboardWidget,
} from "@boardstate/core";
import { renderActionForm } from "./action-form.js";
import { renderActivity } from "./activity.js";
import { renderAgentStatus } from "./agent-status.js";
import { renderApprovals } from "./approvals.js";
import { renderChart } from "./chart.js";
import { renderCron } from "./cron.js";
import { renderIframeEmbed } from "./iframe-embed.js";
import { renderInstances } from "./instances.js";
import { renderMarkdown } from "./markdown.js";
import { renderNotes } from "./notes.js";
import { renderPreview } from "./preview.js";
import { renderSessions } from "./sessions.js";
import { renderStatCard } from "./stat-card.js";
import { renderTable } from "./table.js";
import type { BuiltinWidgetContext } from "./types.js";
import { renderUsage } from "./usage.js";

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

function renderToContainer(template: unknown): HTMLElement {
  const container = document.createElement("div");
  render(template as never, container);
  return container;
}

const STRICT_EMBED: BuiltinWidgetContext = {
  embed: { embedSandboxMode: "strict", allowExternalEmbedUrls: false },
};

describe("stat-card render", () => {
  it("renders the value and omits a duplicate label", () => {
    const container = renderToContainer(
      renderStatCard(widget({ title: "Cost", props: { label: "Cost", format: "usd" } }), 9),
    );
    expect(container.querySelector(".dashboard-stat__value")?.textContent).toContain("$9");
    expect(container.querySelector(".dashboard-stat__label")).toBeNull();
  });

  it("maps a structured usage.cost payload (transform sanity)", () => {
    const model = mapStatCard(
      widget({ title: "Cost Today", props: { metric: "todayCost", format: "usd" } }),
      { totals: { totalCost: 12.5, totalTokens: 4000 } },
    );
    expect(model.display).toBe("$12.50");
  });
});

describe("markdown render", () => {
  it("renders an empty state when there is no content", () => {
    const container = renderToContainer(renderMarkdown(widget(), ""));
    expect(container.querySelector(".dashboard-widget__placeholder")).not.toBeNull();
  });

  it("renders sanitized markdown for content", () => {
    const container = renderToContainer(renderMarkdown(widget(), "# Hello"));
    expect(container.querySelector(".dashboard-markdown")?.textContent).toContain("Hello");
  });
});

describe("table render", () => {
  const rows = [
    { name: "a", cost: 1 },
    { name: "b", cost: 2 },
    { name: "c", cost: 3 },
  ];

  it("accepts { rows } payloads and renders a +N more footer", () => {
    const container = renderToContainer(renderTable(widget({ props: { limit: 2 } }), { rows }));
    expect(container.querySelector(".dashboard-table__footer")?.textContent).toContain("1");
    expect(mapTable(widget({ props: { limit: 2 } }), rows).total).toBe(3);
  });

  it("renders an empty state for no rows", () => {
    const container = renderToContainer(renderTable(widget(), []));
    expect(container.querySelector(".dashboard-widget__placeholder")).not.toBeNull();
  });
});

describe("sessions render", () => {
  it("renders a link per session and an empty state", () => {
    const populated = renderToContainer(
      renderSessions(widget(), { sessions: [{ key: "main:1", displayName: "One" }] }),
    );
    expect(populated.querySelector(".dashboard-list__link")).not.toBeNull();
    expect(mapSessions(widget(), { sessions: [{ key: "main:1" }] }).rows[0]!.key).toBe("main:1");
    const empty = renderToContainer(renderSessions(widget(), { sessions: [] }));
    expect(empty.querySelector(".dashboard-widget__placeholder")).not.toBeNull();
  });
});

describe("usage render", () => {
  it("renders both cost and token metrics", () => {
    const container = renderToContainer(
      renderUsage(widget(), { totals: { totalCost: 5, totalTokens: 2000 } }),
    );
    const values = [...container.querySelectorAll(".dashboard-usage__value")].map(
      (n) => n.textContent,
    );
    expect(values).toHaveLength(2);
    expect(mapUsage(widget(), { totals: { totalCost: 3.2, totalTokens: 999 } }).cost).toBe(3.2);
  });
});

describe("cron render", () => {
  it("renders an empty state without jobs", () => {
    const container = renderToContainer(renderCron(widget(), { jobs: [] }));
    expect(container.querySelector(".dashboard-widget__placeholder")).not.toBeNull();
    expect(
      mapCron(widget(), {
        jobs: [
          { id: "j1", name: "N", enabled: true, state: { nextRunAtMs: 5000, lastRunStatus: "ok" } },
        ],
      }).jobs[0],
    ).toMatchObject({ id: "j1", nextRunAtMs: 5000, lastStatus: "ok" });
  });
});

describe("instances render", () => {
  it("accepts a { presence } wrapper and renders an empty state", () => {
    const populated = renderToContainer(
      renderInstances(widget(), { presence: [{ instanceId: "gw-1" }] }),
    );
    expect(populated.querySelector(".dashboard-instances")).not.toBeNull();
    const empty = renderToContainer(renderInstances(widget(), []));
    expect(empty.querySelector(".dashboard-widget__placeholder")).not.toBeNull();
    expect(
      mapInstances(widget(), [{ instanceId: "gw-1", lastInputSeconds: 5 }]).instances[0],
    ).toMatchObject({ id: "gw-1", healthy: true });
  });
});

describe("activity render", () => {
  it("renders an empty state for no entries", () => {
    const container = renderToContainer(renderActivity(widget(), { entries: [] }));
    expect(container.querySelector(".dashboard-widget__placeholder")).not.toBeNull();
    expect(
      mapActivity(widget(), {
        entries: [{ ts: 1000, jobName: "N", status: "ok", summary: "done" }],
      }).entries[0],
    ).toMatchObject({ title: "N", status: "ok", detail: "done" });
  });
});

describe("iframe-embed URL policy (transform)", () => {
  const origin = "https://control.example";

  it("allows internal URLs and blocks external/scheme", () => {
    expect(evaluateEmbedUrl("/report", { allowExternalEmbedUrls: false }, origin)).toEqual({
      status: "ok",
      url: "/report",
      external: false,
    });
    expect(
      evaluateEmbedUrl("https://evil.example", { allowExternalEmbedUrls: false }, origin),
    ).toEqual({ status: "blocked", reason: "external", url: "https://evil.example" });
    expect(
      evaluateEmbedUrl("javascript:alert(1)", { allowExternalEmbedUrls: true }, origin),
    ).toMatchObject({ status: "blocked", reason: "scheme" });
  });
});

describe("iframe-embed render × sandbox mode", () => {
  it("emits an empty sandbox attr in strict mode", () => {
    const container = renderToContainer(
      renderIframeEmbed(widget({ props: { url: "/preview" } }), null, STRICT_EMBED),
    );
    const frame = container.querySelector<HTMLIFrameElement>(
      '[data-test-id="dashboard-embed-frame"]',
    );
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("sandbox")).toBe("");
  });

  it("scripts mode grants allow-scripts", () => {
    const container = renderToContainer(
      renderIframeEmbed(widget({ props: { url: "/preview" } }), null, {
        embed: { embedSandboxMode: "scripts", allowExternalEmbedUrls: false },
      }),
    );
    const frame = container.querySelector<HTMLIFrameElement>(
      '[data-test-id="dashboard-embed-frame"]',
    );
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
  });

  it("shows a blocked placeholder for an external URL under strict policy", () => {
    const container = renderToContainer(
      renderIframeEmbed(widget({ props: { url: "https://evil.example" } }), null, STRICT_EMBED),
    );
    expect(container.querySelector('[data-test-id="dashboard-embed-blocked"]')).not.toBeNull();
    expect(container.querySelector('[data-test-id="dashboard-embed-frame"]')).toBeNull();
  });
});

describe("chart render (wave-charts)", () => {
  it("renders a placeholder for an empty series", () => {
    const container = renderToContainer(renderChart(widget({ kind: "builtin:chart" }), []));
    expect(container.querySelector('[data-test-id="dashboard-chart"]')).toBeNull();
    expect(container.querySelector(".dashboard-widget__placeholder")).not.toBeNull();
  });

  it("draws an SVG for a populated series", () => {
    const container = renderToContainer(
      renderChart(widget({ kind: "builtin:chart", props: { type: "bar" } }), [1, 2, 3]),
    );
    expect(container.querySelector('[data-test-id="dashboard-chart"]')).not.toBeNull();
    expect(container.querySelector(".dashboard-chart--bar")).not.toBeNull();
  });
});

describe("notes render (wave-notes)", () => {
  it("degrades to a readonly pad with a hint when no state accessor is present", () => {
    const container = renderToContainer(
      renderNotes(widget({ kind: "builtin:notes" }), null, STRICT_EMBED),
    );
    const pad = container.querySelector<HTMLTextAreaElement>(
      '[data-test-id="dashboard-notes-pad"]',
    );
    expect(pad?.hasAttribute("readonly")).toBe(true);
    expect(container.querySelector('[data-test-id="dashboard-notes-hint"]')).not.toBeNull();
  });

  it("renders an editable pad and hydrates from the bound state accessor", async () => {
    const get = vi.fn(async () => ({ state: "hello" }));
    const set = vi.fn(async () => ({ version: 1 }));
    const container = renderToContainer(
      renderNotes(widget({ kind: "builtin:notes" }), null, {
        ...STRICT_EMBED,
        state: { get, set },
      }),
    );
    const pad = container.querySelector<HTMLTextAreaElement>(
      '[data-test-id="dashboard-notes-pad"]',
    );
    expect(pad?.hasAttribute("readonly")).toBe(false);
    await Promise.resolve();
    expect(get).toHaveBeenCalled();
  });
});

describe("action-form render (wave-m1)", () => {
  it("renders a placeholder when no fields are declared", () => {
    const container = renderToContainer(
      renderActionForm(widget({ kind: "builtin:action-form" }), null, STRICT_EMBED),
    );
    expect(container.querySelector('[data-test-id="dashboard-action-form"]')).toBeNull();
  });

  it("dispatches the interpolated prompt through the injected gate on submit", () => {
    const dispatchPrompt = vi.fn(async () => "sent" as const);
    const container = renderToContainer(
      renderActionForm(
        widget({
          kind: "builtin:action-form",
          props: { template: "say {msg}", fields: [{ name: "msg", label: "Msg", type: "text" }] },
        }),
        null,
        { ...STRICT_EMBED, dispatchPrompt },
      ),
    );
    const form = container.querySelector<HTMLFormElement>('[data-test-id="dashboard-action-form"]');
    const input = form?.querySelector<HTMLInputElement>('input[name="msg"]');
    input!.value = "hi";
    form!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    expect(dispatchPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ text: "say hi", widgetKey: "builtin:action-form:w1" }),
    );
  });

  it("marks submit inert when no dispatch gate is injected", () => {
    const container = renderToContainer(
      renderActionForm(
        widget({
          kind: "builtin:action-form",
          props: { template: "x {a}", fields: [{ name: "a", label: "A", type: "text" }] },
        }),
        null,
        STRICT_EMBED,
      ),
    );
    expect(container.querySelector('[data-test-id="dashboard-action-form-inert"]')).not.toBeNull();
  });
});

describe("preview render (wave2b)", () => {
  it("renders a sandboxed iframe for a local URL", () => {
    const container = renderToContainer(
      renderPreview(
        widget({ kind: "builtin:preview", props: { url: "/preview" } }),
        null,
        STRICT_EMBED,
      ),
    );
    const frame = container.querySelector<HTMLIFrameElement>(
      '[data-test-id="dashboard-preview-frame"]',
    );
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("sandbox")).toBe("");
    expect(container.querySelectorAll("[data-viewport]").length).toBe(3);
  });

  it("blocks an external URL under strict policy", () => {
    const container = renderToContainer(
      renderPreview(
        widget({ kind: "builtin:preview", props: { url: "https://evil.example" } }),
        null,
        STRICT_EMBED,
      ),
    );
    expect(container.querySelector('[data-test-id="dashboard-preview-blocked"]')).not.toBeNull();
    expect(container.querySelector('[data-test-id="dashboard-preview-frame"]')).toBeNull();
  });
});

describe("agent-status render (wave-ops)", () => {
  it("renders a placeholder when there are no sessions", () => {
    const container = renderToContainer(
      renderAgentStatus(widget({ kind: "builtin:agent-status" }), { sessions: [] }),
    );
    expect(container.querySelector('[data-test-id="dashboard-agent-status"]')).toBeNull();
  });

  it("lists sessions with a live/idle badge", () => {
    const container = renderToContainer(
      renderAgentStatus(widget({ kind: "builtin:agent-status" }), {
        sessions: [{ key: "s1", displayName: "Agent 1", hasActiveRun: true }],
      }),
    );
    expect(container.querySelector('[data-test-id="dashboard-agent-status"]')).not.toBeNull();
    expect(container.querySelector(".dashboard-dot--live")).not.toBeNull();
  });
});

describe("approvals render (wave-ops)", () => {
  it("renders a placeholder with no pending items", () => {
    const container = renderToContainer(
      renderApprovals(widget({ kind: "builtin:approvals" }), null, {
        ...STRICT_EMBED,
        approvals: { pending: [], onDecide: vi.fn() },
      }),
    );
    expect(container.querySelector('[data-test-id="dashboard-approvals"]')).toBeNull();
  });

  it("resolves a decision through the injected onDecide", () => {
    const onDecide = vi.fn();
    const item = { id: "widget-a", kind: "widget" as const, title: "widget-a", requestedBy: null };
    const container = renderToContainer(
      renderApprovals(widget({ kind: "builtin:approvals" }), null, {
        ...STRICT_EMBED,
        approvals: { pending: [item], onDecide },
      }),
    );
    container
      .querySelector<HTMLButtonElement>('[data-test-id="dashboard-approvals-approve"]')
      ?.click();
    expect(onDecide).toHaveBeenCalledWith(item, "approve");
  });
});
