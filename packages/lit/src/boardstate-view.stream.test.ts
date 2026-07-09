// Stream-binding rendering: a widget bound `{ source: "stream", event, pointer }`
// must subscribe via the transport and re-render with each pushed value. This path
// shipped latent-broken (no template ever carried a stream binding); the app's
// mock live connector exposed it.
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { getDashboardState, stopDashboard } from "@boardstate/host";
import { normalizeWorkspace, type Transport } from "@boardstate/core";
import { renderBoardstateView, type BoardstateViewProps } from "./boardstate-view.js";

function baseProps(
  host: object,
  overrides: Partial<BoardstateViewProps> = {},
): BoardstateViewProps {
  return { host, transport: null, connected: false, ...overrides };
}

const streamDoc = {
  schemaVersion: 1,
  workspaceVersion: 3,
  tabs: [
    {
      slug: "live",
      title: "Live",
      hidden: false,
      createdBy: "user",
      widgets: [
        {
          id: "ticker",
          kind: "builtin:stat-card",
          title: "Revenue",
          grid: { x: 0, y: 0, w: 4, h: 2 },
          collapsed: false,
          hidden: false,
          bindings: { value: { source: "stream", event: "presence", pointer: "/rev" } },
          props: { label: "Live revenue", format: "usd" },
        },
      ],
    },
  ],
  widgetsRegistry: {},
  prefs: { tabOrder: ["live"] },
} as never;

describe("stream bindings in the view", () => {
  it("subscribes on render and re-renders each pushed value into the widget", () => {
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    const transport = {
      request: vi.fn(async () => ({})),
      addEventListener: (event: string, fn: (payload: unknown) => void) => {
        let set = listeners.get(event);
        if (!set) {
          set = new Set();
          listeners.set(event, set);
        }
        set.add(fn);
        return () => set?.delete(fn);
      },
    } as unknown as Transport;
    const broadcast = (event: string, payload: unknown) => {
      for (const fn of listeners.get(event) ?? []) fn(payload);
    };

    const host = document.createElement("div");
    document.body.append(host);
    const state = getDashboardState(host);
    state.loaded = true;
    // Route through normalizeWorkspace — the client store's real load path. The
    // original stream bug lived THERE (the normalizer stripped stream bindings),
    // so assigning the raw doc directly would test a pipeline production never runs.
    state.workspace = normalizeWorkspace(streamDoc);
    state.activeSlug = "live";
    const rerender = () =>
      render(
        renderBoardstateView(
          baseProps(host, { transport, connected: true, onRequestUpdate: rerender }),
        ),
        host,
      );
    try {
      rerender();
      // The render pass must have subscribed to the binding's event.
      expect(listeners.get("presence")?.size ?? 0).toBeGreaterThan(0);

      broadcast("presence", { rev: 1234.5 });
      rerender();
      expect(host.querySelector(".dashboard-stat__value")?.textContent).toContain("1,234.5");

      broadcast("presence", { rev: 2001 });
      rerender();
      expect(host.querySelector(".dashboard-stat__value")?.textContent).toContain("2,001");
    } finally {
      stopDashboard(host);
      host.remove();
    }
  });
});
