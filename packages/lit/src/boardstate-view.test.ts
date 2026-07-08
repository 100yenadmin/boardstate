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
