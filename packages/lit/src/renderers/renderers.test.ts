// Render assertions for the builtin widgets: the empty/populated/blocked
// affordances. The data-shape `map*` transforms are unit-tested in
// `@boardstate/core`; here we lock the DOM each renderer emits. Imports of the
// transforms come from core; the render fns are the package's own.

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { AgentStreamEvent } from "@boardstate/schema";
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
import { renderActionButton } from "./action-button.js";
import { renderActionForm } from "./action-form.js";
import { renderActivity } from "./activity.js";
import { renderAgentStatus } from "./agent-status.js";
import { renderApprovals } from "./approvals.js";
import { renderChart } from "./chart.js";
import { renderChat } from "./chat.js";
import { renderCron } from "./cron.js";
import { renderIframeEmbed } from "./iframe-embed.js";
import { renderInstances } from "./instances.js";
import { renderMarkdown } from "./markdown.js";
import { renderNotes } from "./notes.js";
import { renderPreview } from "./preview.js";
import { renderSessions } from "./sessions.js";
import { renderStatCard } from "./stat-card.js";
import { renderTable } from "./table.js";
import type { ActionChange, ActionInvokeOutcome, BuiltinWidgetContext } from "./types.js";
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

  it("a default chart adds no detail scaffolding (byte-identical to before)", () => {
    // Every pre-existing type EXCEPT sparkline — sparkline's render deliberately changed
    // (fallthrough plain line → true sparkline, the point of #10), so it is excluded here
    // and covered by its own tests below.
    for (const type of ["line", "bar", "area", "gauge"] as const) {
      const container = renderToContainer(
        renderChart(widget({ kind: "builtin:chart", props: { type } }), [1, 5, 2]),
      );
      const chart = container.querySelector<HTMLElement>(".dashboard-chart")!;
      // Only the SVG mounts — no axis/grid/tip overlay leaks into the default render.
      expect(chart.className).toBe(`dashboard-chart dashboard-chart--${type}`);
      expect(chart.children.length).toBe(1);
      expect(chart.querySelector(".dashboard-chart__grid")).toBeNull();
      expect(chart.querySelector(".dashboard-chart__axis")).toBeNull();
      expect(chart.querySelector(".dashboard-chart__tips")).toBeNull();
      expect(chart.querySelector("[class*='__spark']")).toBeNull();
    }
  });

  it("renders a delta-colored sparkline with an optional trailing value label", () => {
    const container = renderToContainer(
      renderChart(
        widget({ kind: "builtin:chart", props: { type: "sparkline", label: true } }),
        [4, 6, 9],
      ),
    );
    expect(container.querySelector(".dashboard-chart--sparkline")).not.toBeNull();
    // Rising series ⇒ "up" trend class drives the delta color.
    expect(container.querySelector(".dashboard-chart__spark--up")).not.toBeNull();
    expect(container.querySelector(".dashboard-chart__spark-value--up")?.textContent).toBe("9");
    // Sparkline stays axis-free even alongside the value label.
    expect(container.querySelector(".dashboard-chart__grid")).toBeNull();
  });

  it("degrades a one-point sparkline to a single end dot", () => {
    const container = renderToContainer(
      renderChart(widget({ kind: "builtin:chart", props: { type: "sparkline" } }), [7]),
    );
    expect(container.querySelector(".dashboard-chart__spark-dot")).not.toBeNull();
    expect(container.querySelector("polyline")).toBeNull();
  });

  it("detail mode adds gridlines, axis labels, and value tooltips", () => {
    const container = renderToContainer(
      renderChart(
        widget({ kind: "builtin:chart", props: { type: "line", detail: true } }),
        [10, 30, 20],
      ),
    );
    expect(container.querySelector(".dashboard-chart--detail")).not.toBeNull();
    expect(container.querySelector(".dashboard-chart__grid")).not.toBeNull();
    expect(container.querySelectorAll(".dashboard-chart__axis").length).toBe(2);
    // A per-point <title> surfaces the value as a native tooltip (no dependency).
    const titles = Array.from(container.querySelectorAll(".dashboard-chart__tip title")).map(
      (node) => node.textContent,
    );
    expect(titles).toContain("30");
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

  it("surfaces a rejected dispatch on the shared toast via onActionError", async () => {
    const onActionError = vi.fn();
    const dispatchPrompt = vi.fn(async () => {
      throw new Error("Not connected.");
    });
    const container = renderToContainer(
      renderActionForm(
        widget({
          kind: "builtin:action-form",
          props: { template: "say {msg}", fields: [{ name: "msg", label: "Msg", type: "text" }] },
        }),
        null,
        { ...STRICT_EMBED, dispatchPrompt, onActionError },
      ),
    );
    const form = container.querySelector<HTMLFormElement>('[data-test-id="dashboard-action-form"]');
    form!.querySelector<HTMLInputElement>('input[name="msg"]')!.value = "hi";
    form!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    // Let the dispatch promise reject and the .catch run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onActionError).toHaveBeenCalledWith("Not connected.");
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

  it("confirms a pending action row (SPEC §18) with the Confirm affordance", () => {
    const onDecide = vi.fn();
    const item = {
      id: "act_1",
      kind: "action" as const,
      title: "officecli:send_mail",
      requestedBy: "agent:main",
      detail: "awaiting confirm",
    };
    const container = renderToContainer(
      renderApprovals(widget({ kind: "builtin:approvals" }), null, {
        ...STRICT_EMBED,
        approvals: { pending: [item], onDecide },
      }),
    );
    const approve = container.querySelector<HTMLButtonElement>(
      '[data-test-id="dashboard-approvals-approve"]',
    )!;
    expect(approve.textContent?.trim()).toBe("Confirm");
    approve.click();
    expect(onDecide).toHaveBeenCalledWith(item, "approve");
  });

  it("grants only the ticked tools of a capability row (SPEC §17.1 partial grant)", () => {
    const onDecide = vi.fn();
    const item = {
      id: "officecli",
      kind: "capability" as const,
      title: "officecli",
      requestedBy: null,
      detail: "wants 2 tools",
      tools: ["officecli:read_mail", "officecli:send_mail"],
    };
    const container = renderToContainer(
      renderApprovals(widget({ kind: "builtin:approvals" }), null, {
        ...STRICT_EMBED,
        approvals: { pending: [item], onDecide },
      }),
    );
    // Untick the mutating tool's GRANT box, then approve → only the read tool is granted.
    // (Each tool now carries a grant box + an auto-confirm box, SPEC §17.2 #62.)
    const boxes = container.querySelectorAll<HTMLInputElement>(
      '[data-test-id="dashboard-approvals-tools"] input.dashboard-approvals__grant',
    );
    expect(boxes).toHaveLength(2);
    boxes[1]!.checked = false;
    container
      .querySelector<HTMLButtonElement>('[data-test-id="dashboard-approvals-approve"]')
      ?.click();
    expect(onDecide).toHaveBeenCalledWith(item, "approve", { tools: ["officecli:read_mail"] });
  });
});

describe("chat render (wave-chat)", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const S = "main";

  /** A scripted chat seam whose history() replays a fixed event sequence. */
  function scriptChat(
    events: AgentStreamEvent[],
    over: Partial<NonNullable<BuiltinWidgetContext["chat"]>> = {},
  ): NonNullable<BuiltinWidgetContext["chat"]> {
    return {
      history: async () => events,
      subscribe: () => () => {},
      send: vi.fn(async () => ({ turnId: "t1" })),
      abort: vi.fn(async () => {}),
      ...over,
    };
  }

  // A live turn (no turn-end) that issued three consecutive tool calls: ok, ok, fail.
  const LIVE_TOOL_TURN: AgentStreamEvent[] = [
    { type: "turn-start", sessionKey: S, turnId: "t1" },
    {
      type: "tool-call-start",
      sessionKey: S,
      turnId: "t1",
      callId: "A",
      name: "dashboard.tab.create",
    },
    {
      type: "tool-call-ready",
      sessionKey: S,
      turnId: "t1",
      callId: "A",
      name: "dashboard.tab.create",
      args: { title: "Sales" },
    },
    { type: "tool-result", sessionKey: S, turnId: "t1", callId: "A", ok: true },
    {
      type: "tool-call-start",
      sessionKey: S,
      turnId: "t1",
      callId: "B",
      name: "dashboard.workspace.get",
    },
    { type: "tool-result", sessionKey: S, turnId: "t1", callId: "B", ok: true },
    {
      type: "tool-call-start",
      sessionKey: S,
      turnId: "t1",
      callId: "C",
      name: "dashboard.widget.add",
    },
    {
      type: "tool-result",
      sessionKey: S,
      turnId: "t1",
      callId: "C",
      ok: false,
      error: { code: "x", message: "no", retryable: false },
    },
  ];

  it("merges consecutive tool calls into one chip and shows Stop while the turn is live", async () => {
    const container = renderToContainer(
      renderChat(widget({ id: "chat-a", kind: "builtin:chat" }), null, {
        ...STRICT_EMBED,
        chat: scriptChat(LIVE_TOOL_TURN),
      }),
    );
    await flush();
    const groups = container.querySelectorAll('[data-test-id="dashboard-chat-tools"]');
    expect(groups).toHaveLength(1);
    expect(container.querySelector(".dashboard-chat__chip-count")?.textContent).toContain(
      "3 actions",
    );
    expect(container.querySelector(".dashboard-chat__chip-marks")?.textContent).toBe("✓✓✗");
    expect(container.querySelector('[data-test-id="dashboard-chat-stop"]')).not.toBeNull();
  });

  it("hides Stop and shows the empty hint when there is no live turn", async () => {
    const complete: AgentStreamEvent[] = [
      { type: "turn-start", sessionKey: S, turnId: "t1" },
      { type: "turn-end", sessionKey: S, turnId: "t1", stopReason: "end" },
    ];
    const live = renderToContainer(
      renderChat(widget({ id: "chat-b", kind: "builtin:chat" }), null, {
        ...STRICT_EMBED,
        chat: scriptChat(complete),
      }),
    );
    await flush();
    expect(live.querySelector('[data-test-id="dashboard-chat-stop"]')).toBeNull();

    const emptyView = renderToContainer(
      renderChat(widget({ id: "chat-c", kind: "builtin:chat" }), null, {
        ...STRICT_EMBED,
        chat: scriptChat([]),
      }),
    );
    await flush();
    expect(emptyView.querySelector('[data-test-id="dashboard-chat-empty"]')).not.toBeNull();
  });

  it("renders an inline approval card during a live turn and resolves it via approveWidget", async () => {
    const approveWidget = vi.fn();
    const container = renderToContainer(
      renderChat(widget({ id: "chat-d", kind: "builtin:chat" }), null, {
        ...STRICT_EMBED,
        chat: scriptChat(LIVE_TOOL_TURN),
        registryPending: ["sales"],
        approveWidget,
      }),
    );
    await flush();
    const card = container.querySelector('[data-test-id="dashboard-chat-approval"]');
    expect(card).not.toBeNull();
    container.querySelector<HTMLButtonElement>('[data-test-id="dashboard-chat-approve"]')?.click();
    expect(approveWidget).toHaveBeenCalledWith("sales", "approved");
  });

  it("degrades to a disabled input with a hint when no chat seam is present", () => {
    const container = renderToContainer(
      renderChat(widget({ id: "chat-e", kind: "builtin:chat" }), null, STRICT_EMBED),
    );
    const textarea = container.querySelector<HTMLTextAreaElement>(
      '[data-test-id="dashboard-chat-textarea"]',
    );
    expect(textarea?.disabled).toBe(true);
    expect(container.querySelector('[data-test-id="dashboard-chat-disconnected"]')).not.toBeNull();
  });
});

describe("action-button render (M5d-1 #44)", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  type ActionsSeam = NonNullable<BuiltinWidgetContext["actions"]>;
  /** A scripted action seam capturing invoke params and driving lifecycle outcomes. */
  function scriptActions(
    over: Partial<ActionsSeam> = {},
  ): ActionsSeam & { emit: (change: ActionChange) => void } {
    let listener: ((change: ActionChange) => void) | null = null;
    return {
      invoke: vi.fn(async (): Promise<ActionInvokeOutcome> => ({ kind: "result", result: "ok" })),
      subscribe: (fn: (change: ActionChange) => void) => {
        listener = fn;
        return () => {
          listener = null;
        };
      },
      ...over,
      // Exposed for tests that push a lifecycle change; not part of the seam type.
      emit: (change: ActionChange) => listener?.(change),
    };
  }

  const btn = (id: string, props: Record<string, unknown>) =>
    widget({ id, kind: "builtin:action-button", props });

  it("shows the disconnected hint and a disabled button when no action seam exists", () => {
    const container = renderToContainer(
      renderActionButton(btn("ab-disc", { connector: "c", tool: "t" }), null, STRICT_EMBED),
    );
    const invoke = container.querySelector<HTMLButtonElement>(
      '[data-test-id="dashboard-action-button-invoke"]',
    );
    expect(invoke?.disabled).toBe(true);
    expect(
      container.querySelector('[data-test-id="dashboard-action-button-disconnected"]'),
    ).not.toBeNull();
  });

  it("invokes with the EXACT {connector,tool,args} shape and renders a readOnly result INERT", async () => {
    const actions = scriptActions({
      invoke: vi.fn(
        async () => ({ kind: "result", result: "<img src=x onerror=alert(1)>" }) as never,
      ),
    });
    const container = renderToContainer(
      renderActionButton(
        btn("ab-read", {
          connector: "officecli",
          tool: "status",
          args: { svc: "web" },
          label: "Check",
        }),
        null,
        { ...STRICT_EMBED, actions },
      ),
    );
    container
      .querySelector<HTMLButtonElement>('[data-test-id="dashboard-action-button-invoke"]')
      ?.click();
    await flush();
    expect(actions.invoke).toHaveBeenCalledWith({
      connector: "officecli",
      tool: "status",
      args: { svc: "web" },
    });
    const result = container.querySelector('[data-test-id="dashboard-action-button-result"]');
    // Untrusted markup renders as literal text (no <img> element materializes).
    expect(result?.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(container.querySelector("img")).toBeNull();
  });

  it("parks a mutation and offers inline confirm→result for the local operator", async () => {
    const actions = scriptActions({
      invoke: vi.fn(async () => ({ kind: "pending", id: "act_9", expiresAt: "Z" }) as never),
      confirm: vi.fn(async () => ({ result: "done" })),
      deny: vi.fn(async () => {}),
    });
    const container = renderToContainer(
      renderActionButton(btn("ab-mut", { connector: "c", tool: "restart" }), null, {
        ...STRICT_EMBED,
        actions,
      }),
    );
    container
      .querySelector<HTMLButtonElement>('[data-test-id="dashboard-action-button-invoke"]')
      ?.click();
    await flush();
    expect(
      container.querySelector('[data-test-id="dashboard-action-button-pending"]'),
    ).not.toBeNull();
    container
      .querySelector<HTMLButtonElement>('[data-test-id="dashboard-action-button-confirm"]')
      ?.click();
    await flush();
    expect(actions.confirm).toHaveBeenCalledWith("act_9");
    expect(
      container.querySelector('[data-test-id="dashboard-action-button-result"]')?.textContent,
    ).toContain("done");
  });

  it("renders the confirm affordance disabled-with-reason over a networked (non-operator) transport", async () => {
    // No confirm/deny on the seam ⇒ networked client: invoke still parks, but the widget
    // shows the operator-only reason instead of confirm/deny buttons.
    const actions = scriptActions({
      invoke: vi.fn(async () => ({ kind: "pending", id: "act_1", expiresAt: "Z" }) as never),
    });
    const container = renderToContainer(
      renderActionButton(btn("ab-net", { connector: "c", tool: "restart" }), null, {
        ...STRICT_EMBED,
        actions,
      }),
    );
    container
      .querySelector<HTMLButtonElement>('[data-test-id="dashboard-action-button-invoke"]')
      ?.click();
    await flush();
    expect(container.querySelector('[data-test-id="dashboard-action-button-confirm"]')).toBeNull();
    expect(
      container.querySelector('[data-test-id="dashboard-action-button-operator-only"]'),
    ).not.toBeNull();
  });

  it("surfaces a revoked-between-validate-and-invoke rejection loudly", async () => {
    const actions = scriptActions({
      invoke: vi.fn(async () => {
        throw new Error('tool "c:t" is not granted — request and approve it first');
      }),
    });
    const container = renderToContainer(
      renderActionButton(btn("ab-revoked", { connector: "c", tool: "t" }), null, {
        ...STRICT_EMBED,
        actions,
      }),
    );
    container
      .querySelector<HTMLButtonElement>('[data-test-id="dashboard-action-button-invoke"]')
      ?.click();
    await flush();
    expect(
      container.querySelector('[data-test-id="dashboard-action-button-error"]')?.textContent,
    ).toContain("not granted");
  });

  it("updates a parked action to denied on a dashboard.action.changed event", async () => {
    const actions = scriptActions({
      invoke: vi.fn(async () => ({ kind: "pending", id: "act_5", expiresAt: "Z" }) as never),
    });
    const container = renderToContainer(
      renderActionButton(btn("ab-deny", { connector: "c", tool: "t" }), null, {
        ...STRICT_EMBED,
        actions,
      }),
    );
    container
      .querySelector<HTMLButtonElement>('[data-test-id="dashboard-action-button-invoke"]')
      ?.click();
    await flush();
    actions.emit({ id: "act_5", status: "denied", connector: "c", tool: "t" });
    await flush();
    expect(
      container.querySelector('[data-test-id="dashboard-action-button-denied"]'),
    ).not.toBeNull();
  });
});

describe("action-form tool mode (M5d-1 #44)", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  const toolForm = (id: string) =>
    widget({
      id,
      kind: "builtin:action-form",
      props: {
        mode: "tool",
        connector: "officecli",
        tool: "create_issue",
        template: "Create {title}",
        fields: [{ name: "title", label: "Title", type: "text" }],
        argsFrom: { name: "title" },
      },
    });

  it("submits field values as tool args through the action seam and resets on a readOnly result", async () => {
    const invoke = vi.fn(async (): Promise<ActionInvokeOutcome> => ({
      kind: "result",
      result: "ok",
    }));
    const actions: NonNullable<BuiltinWidgetContext["actions"]> = {
      invoke,
      subscribe: () => () => {},
    };
    const container = renderToContainer(
      renderActionForm(toolForm("af-tool"), null, { ...STRICT_EMBED, actions }),
    );
    const form = container.querySelector<HTMLFormElement>(
      '[data-test-id="dashboard-action-form"]',
    )!;
    (form.elements.namedItem("title") as HTMLInputElement).value = "Broken build";
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await flush();
    expect(invoke).toHaveBeenCalledWith({
      connector: "officecli",
      tool: "create_issue",
      args: { name: "Broken build" },
    });
  });

  it("surfaces a parked mutation on the shared toast", async () => {
    const invoke = vi.fn(async (): Promise<ActionInvokeOutcome> => ({
      kind: "pending",
      id: "act_2",
      expiresAt: "Z",
    }));
    const onActionError = vi.fn();
    const actions: NonNullable<BuiltinWidgetContext["actions"]> = {
      invoke,
      subscribe: () => () => {},
    };
    const container = renderToContainer(
      renderActionForm(toolForm("af-tool-pending"), null, {
        ...STRICT_EMBED,
        actions,
        onActionError,
      }),
    );
    const form = container.querySelector<HTMLFormElement>(
      '[data-test-id="dashboard-action-form"]',
    )!;
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await flush();
    expect(onActionError).toHaveBeenCalledWith(expect.stringContaining("operator"));
  });

  it("renders the inert marker when a tool form has no action seam", () => {
    const container = renderToContainer(
      renderActionForm(toolForm("af-tool-inert"), null, STRICT_EMBED),
    );
    expect(container.querySelector('[data-test-id="dashboard-action-form-inert"]')).not.toBeNull();
  });
});
