import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDashboardState, stopDashboard } from "@boardstate/host";
import type { Transport } from "@boardstate/core";
import {
  BoardstateViewElement,
  renderBoardstateView,
  type BoardstateViewProps,
} from "./boardstate-view.js";

/** A no-op transport stub (request resolves empty; subscribe returns an unsub). */
function stubTransport(request = vi.fn(async () => ({}))): Transport {
  return { request, addEventListener: vi.fn(() => () => {}) } as unknown as Transport;
}

function baseProps(
  host: object,
  overrides: Partial<BoardstateViewProps> = {},
): BoardstateViewProps {
  return { host, transport: null, connected: false, ...overrides };
}

function renderView(host: object): HTMLElement {
  const container = document.createElement("div");
  render(renderBoardstateView(baseProps(host)), container);
  return container;
}

const doc = {
  schemaVersion: 1,
  workspaceVersion: 1,
  tabs: [
    {
      slug: "main",
      title: "Main",
      hidden: false,
      widgets: [
        {
          id: "w1",
          kind: "builtin:markdown",
          title: "Notes",
          grid: { x: 0, y: 0, w: 6, h: 2 },
          collapsed: false,
          props: { markdown: "hello" },
        },
      ],
    },
    { slug: "hidden-one", title: "Hidden", hidden: true, widgets: [] },
    { slug: "empty", title: "Empty", hidden: false, widgets: [] },
  ],
  widgetsRegistry: {},
  prefs: { tabOrder: ["main", "empty", "hidden-one"] },
} as never;

describe("<boardstate-view> registration", () => {
  it("is defined as a custom element", () => {
    expect(customElements.get("boardstate-view")).toBe(BoardstateViewElement);
  });
});

describe("renderBoardstateView", () => {
  it("shows the onboarding empty state with no tabs", () => {
    const host = {};
    const state = getDashboardState(host);
    state.loaded = true;
    state.workspace = {
      schemaVersion: 1,
      workspaceVersion: 1,
      capabilitiesRegistry: {},
      tabs: [],
      widgetsRegistry: {},
      prefs: { tabOrder: [] },
    };
    const container = renderView(host);
    expect(container.querySelector('[data-test-id="dashboard-empty"]')).not.toBeNull();
  });

  it("renders the tab strip with visible tabs and a hidden overflow", () => {
    const host = {};
    const state = getDashboardState(host);
    state.loaded = true;
    state.workspace = doc;
    state.activeSlug = "main";
    const container = renderView(host);
    const tabs = container.querySelectorAll('[data-test-id="dashboard-tab"]');
    expect(tabs.length).toBe(2); // main + empty (hidden-one is in overflow)
    expect(container.querySelector(".dashboard-tabs__hidden")).not.toBeNull();
    expect(container.querySelector('[data-test-id="dashboard-grid"]')).not.toBeNull();
  });

  it("selects a tab via onNavigate + local activeSlug", () => {
    const host = {};
    const state = getDashboardState(host);
    state.loaded = true;
    state.workspace = doc;
    state.activeSlug = "main";
    const onNavigate = vi.fn();
    const container = document.createElement("div");
    render(renderBoardstateView(baseProps(host, { onNavigate })), container);
    const emptyTab = [
      ...container.querySelectorAll<HTMLButtonElement>('[data-test-id="dashboard-tab"]'),
    ].find((button) => button.getAttribute("data-ws") === "empty");
    emptyTab?.click();
    expect(onNavigate).toHaveBeenCalledWith("empty");
    expect(state.activeSlug).toBe("empty");
  });

  it("renders the empty-tab hint for a tab with no widgets", () => {
    const host = {};
    const state = getDashboardState(host);
    state.loaded = true;
    state.workspace = doc;
    state.activeSlug = "empty";
    const container = renderView(host);
    expect(container.querySelector('[data-test-id="dashboard-empty-tab"]')).not.toBeNull();
  });

  it("surfaces an action error toast", () => {
    const host = {};
    const state = getDashboardState(host);
    state.loaded = true;
    state.workspace = doc;
    state.activeSlug = "main";
    state.actionError = "move failed";
    const container = renderView(host);
    expect(container.querySelector(".dashboard__toast")?.textContent).toContain("move failed");
  });
});

describe("drag ghost", () => {
  it("renders a snapped drop-target ghost while a drag is in flight", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const transport = stubTransport();
    const state = getDashboardState(host);
    state.loaded = true;
    state.workspace = doc;
    state.activeSlug = "main";
    try {
      render(renderBoardstateView(baseProps(host, { transport, connected: true })), host);
      const grid = host.querySelector<HTMLElement>(".dashboard-grid");
      Object.defineProperty(grid, "clientWidth", { value: 720, configurable: true });
      expect(host.querySelector('[data-test-id="dashboard-drag-ghost"]')).toBeNull();
      const bar = host.querySelector<HTMLElement>(".dashboard-widget__bar");
      bar!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }),
      );
      render(renderBoardstateView(baseProps(host, { transport, connected: true })), host);
      expect(host.querySelector('[data-test-id="dashboard-drag-ghost"]')).not.toBeNull();
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 10, clientY: 10 }));
      render(renderBoardstateView(baseProps(host, { transport, connected: true })), host);
      expect(host.querySelector('[data-test-id="dashboard-drag-ghost"]')).toBeNull();
    } finally {
      stopDashboard(host);
      host.remove();
    }
  });
});

describe("mid-drag tab-switch cancellation", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("cancels an in-flight drag on stopDashboard so a later pointerup is a no-op", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const request = vi.fn(async (..._args: unknown[]) => ({}));
    const transport = stubTransport(request);
    const state = getDashboardState(host);
    state.loaded = true;
    state.workspace = doc;
    state.activeSlug = "main";
    render(renderBoardstateView(baseProps(host, { transport, connected: true })), host);

    const grid = host.querySelector<HTMLElement>(".dashboard-grid");
    expect(grid).not.toBeNull();
    Object.defineProperty(grid, "clientWidth", { value: 720, configurable: true });

    const added = new Set<string>();
    const originalAdd = window.addEventListener.bind(window);
    const originalRemove = window.removeEventListener.bind(window);
    const addSpy = vi
      .spyOn(window, "addEventListener")
      .mockImplementation((type: string, ...rest: unknown[]) => {
        if (type === "pointermove" || type === "pointerup") {
          added.add(type);
        }
        return (originalAdd as (t: string, ...r: unknown[]) => void)(type, ...rest);
      });
    const removeSpy = vi
      .spyOn(window, "removeEventListener")
      .mockImplementation((type: string, ...rest: unknown[]) => {
        if (type === "pointermove" || type === "pointerup") {
          added.delete(type);
        }
        return (originalRemove as (t: string, ...r: unknown[]) => void)(type, ...rest);
      });

    try {
      const bar = host.querySelector<HTMLElement>(".dashboard-widget__bar");
      expect(bar).not.toBeNull();
      bar!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }),
      );
      expect(added.has("pointermove")).toBe(true);
      expect(added.has("pointerup")).toBe(true);

      stopDashboard(host);

      expect(added.has("pointermove")).toBe(false);
      expect(added.has("pointerup")).toBe(false);

      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 400, clientY: 200 }));
      expect(request.mock.calls.some(([method]) => method === "dashboard.widget.move")).toBe(false);
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
      host.remove();
    }
  });
});

describe("ephemeral pin (wave-m1)", () => {
  it("renders the temporary badge and a Pin menu item for an ephemeral widget", () => {
    const host = {};
    const state = getDashboardState(host);
    state.loaded = true;
    state.workspace = {
      schemaVersion: 1,
      workspaceVersion: 1,
      tabs: [
        {
          slug: "main",
          title: "Main",
          hidden: false,
          widgets: [
            {
              id: "w1",
              kind: "builtin:markdown",
              title: "Answer",
              grid: { x: 0, y: 0, w: 6, h: 2 },
              collapsed: false,
              ephemeral: { expiresAt: "2999-01-01T00:00:00.000Z" },
              props: { markdown: "hi" },
            },
          ],
        },
      ],
      widgetsRegistry: {},
      prefs: { tabOrder: ["main"] },
    } as never;
    state.activeSlug = "main";
    const container = renderView(host);
    expect(container.querySelector('[data-test-id="dashboard-widget-ephemeral"]')).not.toBeNull();
  });
});

describe("full-bleed layout (wave-w3)", () => {
  it("renders the first widget full-bleed when the tab layout is full", () => {
    const host = {};
    const state = getDashboardState(host);
    state.loaded = true;
    state.workspace = {
      schemaVersion: 1,
      workspaceVersion: 1,
      tabs: [
        {
          slug: "main",
          title: "Main",
          hidden: false,
          layout: "full",
          widgets: [
            {
              id: "w1",
              kind: "builtin:markdown",
              title: "Report",
              grid: { x: 0, y: 0, w: 12, h: 8 },
              collapsed: false,
              props: { markdown: "hi" },
            },
          ],
        },
      ],
      widgetsRegistry: {},
      prefs: { tabOrder: ["main"] },
    } as never;
    state.activeSlug = "main";
    const container = renderView(host);
    expect(container.querySelector('[data-test-id="dashboard-fullbleed"]')).not.toBeNull();
    expect(container.querySelector('[data-test-id="dashboard-grid"]')).toBeNull();
  });
});

describe("private tab + grouping (wave-w4)", () => {
  it("marks a private tab and groups tabs by authoring actor", () => {
    const host = {};
    const state = getDashboardState(host);
    state.loaded = true;
    state.workspace = {
      schemaVersion: 1,
      workspaceVersion: 1,
      tabs: [
        { slug: "mine", title: "Mine", hidden: false, createdBy: "user", widgets: [] },
        {
          slug: "agentic",
          title: "Agentic",
          hidden: false,
          visibility: "private",
          createdBy: "agent:bot",
          widgets: [],
        },
      ],
      widgetsRegistry: {},
      prefs: { tabOrder: ["mine", "agentic"] },
    } as never;
    state.activeSlug = "mine";
    const container = renderView(host);
    expect(container.querySelector('[data-test-id="dashboard-tab-private"]')).not.toBeNull();
    expect(
      container.querySelectorAll('[data-test-id="dashboard-tab-group"]').length,
    ).toBeGreaterThan(1);
  });
});

describe("workspace header actions (wave-m2 / wave-w3 / wave-w5)", () => {
  it("opens the history panel from the toggle", () => {
    const host = {};
    const state = getDashboardState(host);
    state.loaded = true;
    state.workspace = doc;
    state.activeSlug = "main";
    const container = document.createElement("div");
    const transport = stubTransport();
    render(renderBoardstateView(baseProps(host, { transport, connected: true })), container);
    container
      .querySelector<HTMLButtonElement>('[data-test-id="dashboard-history-toggle"]')
      ?.click();
    render(renderBoardstateView(baseProps(host, { transport, connected: true })), container);
    expect(container.querySelector('[data-test-id="dashboard-history"]')).not.toBeNull();
    stopDashboard(host);
  });

  it("renders the snapshot preview (glyph + caption) and a row change summary (#4)", async () => {
    const host = {};
    const state = getDashboardState(host);
    state.loaded = true;
    state.workspace = doc;
    state.activeSlug = "main";
    const request = vi.fn(async (method: string) => {
      if (method === "dashboard.workspace.history.list") {
        return {
          entries: [
            {
              version: 2,
              savedAt: new Date().toISOString(),
              bytes: 100,
              summary: {
                added: 1,
                removed: 0,
                moved: 0,
                retitled: 0,
                tabsChanged: 0,
                total: 1,
              },
            },
          ],
        };
      }
      if (method === "dashboard.workspace.history.get") {
        return {
          doc: {
            schemaVersion: 1,
            workspaceVersion: 2,
            tabs: [
              {
                slug: "main",
                title: "Main",
                hidden: false,
                widgets: [
                  {
                    id: "chart-1",
                    kind: "builtin:chart",
                    title: "Revenue",
                    grid: { x: 0, y: 0, w: 6, h: 2 },
                    collapsed: false,
                    hidden: false,
                  },
                ],
              },
            ],
            prefs: { tabOrder: ["main"] },
            widgetsRegistry: {},
          },
        };
      }
      return {};
    });
    const container = document.createElement("div");
    const props = baseProps(host, { transport: stubTransport(request as never), connected: true });
    render(renderBoardstateView(props), container);
    container
      .querySelector<HTMLButtonElement>('[data-test-id="dashboard-history-toggle"]')
      ?.click();
    // The list + first snapshot load asynchronously; re-render until the preview lands.
    await vi.waitFor(() => {
      render(renderBoardstateView(props), container);
      expect(container.querySelector('[data-test-id="dashboard-history-preview"]')).not.toBeNull();
    });
    // Per-kind glyph inside the cell, and the "Layout at version N" caption.
    expect(container.querySelector(".dashboard-history__cell-glyph")).not.toBeNull();
    expect(container.querySelector(".dashboard-history__preview-caption")?.textContent).toContain(
      "version 2",
    );
    // The list row shows the compact change summary + dominant actor.
    const change = container.querySelector(".dashboard-history__change");
    expect(change?.textContent).toContain("+1");
    // No actor in the row — creator provenance must not masquerade as change authorship
    // (adversarial verify 2026-07-11; counts-only until the ring stores a per-save author).
    expect(change?.textContent).not.toContain("agent:main");
    stopDashboard(host);
  });

  it("renders the history panel under dir=rtl without error (RTL smoke, #4)", () => {
    document.documentElement.dir = "rtl";
    try {
      const host = {};
      const state = getDashboardState(host);
      state.loaded = true;
      state.workspace = doc;
      state.activeSlug = "main";
      const container = document.createElement("div");
      const props = baseProps(host, { transport: stubTransport(), connected: true });
      render(renderBoardstateView(props), container);
      container
        .querySelector<HTMLButtonElement>('[data-test-id="dashboard-history-toggle"]')
        ?.click();
      render(renderBoardstateView(props), container);
      expect(container.querySelector('[data-test-id="dashboard-history"]')).not.toBeNull();
      stopDashboard(host);
    } finally {
      document.documentElement.dir = "";
    }
  });

  it("opens the widget gallery from the toggle", () => {
    const host = {};
    const state = getDashboardState(host);
    state.loaded = true;
    state.workspace = doc;
    state.activeSlug = "main";
    const container = document.createElement("div");
    render(renderBoardstateView(baseProps(host)), container);
    container.querySelector<HTMLButtonElement>('[data-test-id="dashboard-gallery-open"]')?.click();
    render(renderBoardstateView(baseProps(host)), container);
    expect(container.querySelector('[data-test-id="dashboard-gallery"]')).not.toBeNull();
  });

  it("exposes the export/import distribution controls", () => {
    const host = {};
    const state = getDashboardState(host);
    state.loaded = true;
    state.workspace = doc;
    state.activeSlug = "main";
    const container = renderView(host);
    expect(container.querySelector('[data-test-id="dashboard-export"]')).not.toBeNull();
    expect(container.querySelector('[data-test-id="dashboard-import-input"]')).not.toBeNull();
  });
});

/** A workspace with widgets authored by two distinct agents (a multi-agent board). */
function multiAgentDoc() {
  return {
    schemaVersion: 1,
    workspaceVersion: 1,
    capabilitiesRegistry: {},
    widgetsRegistry: {},
    prefs: { tabOrder: ["main"] },
    tabs: [
      {
        slug: "main",
        title: "Main",
        hidden: false,
        widgets: [
          {
            id: "wa",
            kind: "builtin:markdown",
            title: "Alice widget",
            grid: { x: 0, y: 0, w: 6, h: 2 },
            collapsed: false,
            createdBy: "agent:alice",
            props: { markdown: "a" },
          },
          {
            id: "wb",
            kind: "builtin:markdown",
            title: "Bob widget",
            grid: { x: 6, y: 0, w: 6, h: 2 },
            collapsed: false,
            createdBy: "agent:bob",
            props: { markdown: "b" },
          },
        ],
      },
    ],
  } as never;
}

describe("multi-agent provenance chips (SPEC §17.3, #59)", () => {
  it("renders a per-agent chip per widget + the filter bar when ≥2 agents author the board", () => {
    const host = {};
    const state = getDashboardState(host);
    state.loaded = true;
    state.workspace = multiAgentDoc();
    state.activeSlug = "main";
    const container = renderView(host);
    const chips = container.querySelectorAll('[data-test-id="dashboard-widget-agent-chip"]');
    expect(chips).toHaveLength(2);
    expect([...chips].map((c) => c.getAttribute("data-agent")).sort()).toEqual([
      "agent:alice",
      "agent:bob",
    ]);
    // The filter bar appears with a chip per agent + an "All" reset.
    expect(container.querySelector('[data-test-id="dashboard-agent-filter"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-test-id="dashboard-agent-filter-chip"]')).toHaveLength(
      2,
    );
  });

  it("hides chips + filter on a single-agent board (plain provenance chip only)", () => {
    const host = {};
    const state = getDashboardState(host);
    state.loaded = true;
    state.workspace = doc; // the base doc: one unstamped widget
    state.activeSlug = "main";
    const container = renderView(host);
    expect(container.querySelector('[data-test-id="dashboard-widget-agent-chip"]')).toBeNull();
    expect(container.querySelector('[data-test-id="dashboard-agent-filter"]')).toBeNull();
  });

  it("filtering to one agent dims the other agent's widgets", () => {
    const host = {};
    const state = getDashboardState(host);
    state.loaded = true;
    state.workspace = multiAgentDoc();
    state.activeSlug = "main";
    const container = document.createElement("div");
    render(renderBoardstateView(baseProps(host)), container);
    // Click the first agent's filter chip (alice — sorted first).
    const aliceChip = container.querySelector<HTMLButtonElement>(
      '[data-test-id="dashboard-agent-filter-chip"]',
    );
    aliceChip?.click();
    render(renderBoardstateView(baseProps(host)), container);
    const bobCell = container.querySelector('[data-widget-id="wb"]');
    const aliceCell = container.querySelector('[data-widget-id="wa"]');
    expect(bobCell?.classList.contains("dashboard-widget--agent-dimmed")).toBe(true);
    expect(aliceCell?.classList.contains("dashboard-widget--agent-dimmed")).toBe(false);
  });
});
