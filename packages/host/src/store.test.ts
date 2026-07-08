import { describe, expect, it, vi } from "vitest";
import { normalizeWorkspace, type Transport } from "@boardstate/core";
import {
  cancelActiveDrag,
  clearActiveDrag,
  DASHBOARD_POLL_INTERVAL_MS,
  exportWorkspace,
  getDashboardState,
  hideWidget,
  importWorkspace,
  loadWorkspace,
  moveWidget,
  moveWidgetToTab,
  registerActiveDrag,
  removeWidgetFromTab,
  resolveBinding,
  resolveComputedBinding,
  setWidgetCollapsed,
  startBindingPolling,
  stopBindingPolling,
  stopDashboard,
  subscribeToDashboardEvents,
  subscribeToStreamBinding,
  updateWidgetTitle,
} from "./store.js";

function mockTransport(overrides: Partial<Transport> = {}): Transport {
  return {
    request: vi.fn(async () => ({})),
    addEventListener: vi.fn(() => () => {}),
    ...overrides,
  } as unknown as Transport;
}

const sampleDoc = {
  schemaVersion: 1,
  workspaceVersion: 3,
  tabs: [
    {
      slug: "main",
      title: "Main",
      hidden: false,
      widgets: [
        {
          id: "w1",
          kind: "builtin:stat-card",
          title: "Revenue",
          grid: { x: 0, y: 0, w: 4, h: 2 },
          collapsed: false,
          createdBy: "agent:finance",
        },
      ],
    },
    { slug: "archive", title: "Archive", hidden: true, widgets: [] },
  ],
  prefs: { tabOrder: ["archive", "main"] },
};

describe("loadWorkspace", () => {
  it("fetches and stores the workspace, seeding the active slug", async () => {
    const host = {};
    const state = getDashboardState(host);
    const transport = mockTransport({
      // Real gateway shape: dashboard.workspace.get returns { doc, workspaceVersion }.
      request: vi.fn(async () => ({ doc: sampleDoc, workspaceVersion: 3 })) as never,
    });
    await loadWorkspace(state, transport, { requestedSlug: "archive" });
    expect(state.loaded).toBe(true);
    // The workspace actually populates (tabs present), not an empty fallback.
    expect(state.workspace?.workspaceVersion).toBe(3);
    expect(state.workspace?.tabs).toHaveLength(2);
    expect(state.activeSlug).toBe("archive");
  });

  it("records an error on failure", async () => {
    const host = {};
    const state = getDashboardState(host);
    const transport = mockTransport({
      request: vi.fn(async () => {
        throw new Error("boom");
      }) as never,
    });
    await loadWorkspace(state, transport);
    expect(state.error).toBe("boom");
    expect(state.loaded).toBe(false);
  });
});

describe("optimistic mutations", () => {
  it("applies collapse optimistically and persists it", async () => {
    const host = {};
    const state = getDashboardState(host);
    state.workspace = normalizeWorkspace(sampleDoc);
    const request = vi.fn(async () => ({}));
    const transport = mockTransport({ request: request as never });
    await setWidgetCollapsed(state, transport, { slug: "main", widgetId: "w1", collapsed: true });
    expect(state.workspace?.tabs[0]!.widgets[0]!.collapsed).toBe(true);
    // Wire contract: the gateway's dashboard.widget.update reads { tab, id, patch }.
    expect(request).toHaveBeenCalledWith("dashboard.widget.update", {
      tab: "main",
      id: "w1",
      patch: { collapsed: true },
    });
  });

  it("sends every widget mutation in the gateway's { tab, id, ... } param contract", async () => {
    // Regression guard for the client↔gateway seam: the gateway readParams whitelists
    // are { tab, id, patch } (update), { tab, id, grid|toTab } (move), { tab, id }
    // (remove) — NOT the client's internal { slug, widgetId }. These are asserted at
    // the wire so a drift back to { slug, widgetId, <field> } fails here rather than
    // only at runtime against the real gateway.
    const host = {};
    const state = getDashboardState(host);
    state.workspace = normalizeWorkspace(sampleDoc);
    const request = vi.fn(async () => ({}));
    const transport = mockTransport({ request: request as never });

    await moveWidget(state, transport, {
      slug: "main",
      widgetId: "w1",
      grid: { x: 8, y: 0, w: 4, h: 2 },
    });
    expect(request).toHaveBeenLastCalledWith("dashboard.widget.move", {
      tab: "main",
      id: "w1",
      grid: { x: 8, y: 0, w: 4, h: 2 },
    });

    await updateWidgetTitle(state, transport, { slug: "main", widgetId: "w1", title: "Renamed" });
    expect(request).toHaveBeenLastCalledWith("dashboard.widget.update", {
      tab: "main",
      id: "w1",
      patch: { title: "Renamed" },
    });

    await hideWidget(state, transport, { slug: "main", widgetId: "w1" });
    expect(request).toHaveBeenLastCalledWith("dashboard.widget.update", {
      tab: "main",
      id: "w1",
      patch: { hidden: true },
    });

    state.workspace = normalizeWorkspace(sampleDoc);
    await removeWidgetFromTab(state, transport, { slug: "main", widgetId: "w1" });
    expect(request).toHaveBeenLastCalledWith("dashboard.widget.remove", { tab: "main", id: "w1" });

    state.workspace = normalizeWorkspace(sampleDoc);
    await moveWidgetToTab(state, transport, {
      fromSlug: "main",
      toSlug: "archive",
      widgetId: "w1",
    });
    expect(request).toHaveBeenLastCalledWith("dashboard.widget.move", {
      tab: "main",
      id: "w1",
      toTab: "archive",
    });
  });

  it("reverts and surfaces an error when the RPC rejects", async () => {
    const host = {};
    const state = getDashboardState(host);
    state.workspace = normalizeWorkspace(sampleDoc);
    const transport = mockTransport({
      request: vi.fn(async () => {
        throw new Error("rejected");
      }) as never,
    });
    await moveWidget(state, transport, {
      slug: "main",
      widgetId: "w1",
      grid: { x: 8, y: 0, w: 4, h: 2 },
    });
    // Reverted to original grid; error surfaced for the toast.
    expect(state.workspace?.tabs[0]!.widgets[0]!.grid).toEqual({ x: 0, y: 0, w: 4, h: 2 });
    expect(state.actionError).toBe("rejected");
    expect(state.pendingWidgetIds.has("w1")).toBe(false);
  });

  it("does not stomp a fresher concurrent load when the mutation later rejects", async () => {
    const host = {};
    const state = getDashboardState(host);
    state.workspace = normalizeWorkspace(sampleDoc); // version 3

    // The mutation RPC hangs until we reject it, letting a concurrent refetch land.
    let rejectMutation!: (err: Error) => void;
    const transport = mockTransport({
      request: vi.fn(
        (method: string) =>
          new Promise((_resolve, reject) => {
            if (method === "dashboard.widget.move") {
              rejectMutation = reject;
            }
          }),
      ) as never,
    });

    const mutation = moveWidget(state, transport, {
      slug: "main",
      widgetId: "w1",
      grid: { x: 8, y: 0, w: 4, h: 2 },
    });

    // A concurrent broadcast refetch lands a FRESHER doc (version 4) mid-flight.
    const fresher = normalizeWorkspace({ ...sampleDoc, workspaceVersion: 4 });
    fresher.tabs[0]!.widgets[0]!.title = "Revenue (v4)";
    state.workspace = fresher;

    // Now the in-flight mutation fails.
    rejectMutation(new Error("rejected"));
    await mutation;

    // The fresher doc must survive — no revert to the stale pre-mutation snapshot.
    expect(state.workspace).toBe(fresher);
    expect(state.workspace?.workspaceVersion).toBe(4);
    expect(state.workspace?.tabs[0]!.widgets[0]!.title).toBe("Revenue (v4)");
    expect(state.actionError).toBe("rejected");
  });
});

describe("live-update subscription", () => {
  it("subscribes to boardstate.changed and refetches only on a strictly newer version", async () => {
    const host = {};
    const state = getDashboardState(host);
    state.workspace = normalizeWorkspace(sampleDoc); // version 3
    let handler: ((payload: unknown) => void) | null = null;
    let subscribedEvent: string | null = null;
    const request = vi.fn(async () => ({
      doc: { ...sampleDoc, workspaceVersion: 4 },
      workspaceVersion: 4,
    }));
    const transport = mockTransport({
      request: request as never,
      addEventListener: vi.fn((event: string, fn: (payload: unknown) => void) => {
        subscribedEvent = event;
        handler = fn;
        return () => {};
      }) as never,
    });
    subscribeToDashboardEvents(host, state, transport);
    expect(subscribedEvent).toBe("boardstate.changed");
    expect(handler).not.toBeNull();

    // Stale / own-echo version: no refetch.
    handler!({ workspaceVersion: 3 });
    expect(request).not.toHaveBeenCalled();

    // Newer version: refetch.
    handler!({ workspaceVersion: 4 });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    stopDashboard(host);
  });

  it("tears down the listener on stop", () => {
    const host = {};
    const state = getDashboardState(host);
    const unsubscribe = vi.fn();
    const transport = mockTransport({
      addEventListener: vi.fn(() => unsubscribe) as never,
    });
    subscribeToDashboardEvents(host, state, transport);
    stopDashboard(host);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("binding resolution", () => {
  it("resolves static bindings from the literal value", async () => {
    const result = await resolveBinding(null, { source: "static", value: 42 });
    expect(result).toEqual({ value: 42 });
  });

  it("resolves rpc bindings on the client and applies the pointer", async () => {
    const transport = mockTransport({
      request: vi.fn(async () => ({ revenue: 1000 })) as never,
    });
    const result = await resolveBinding(transport, {
      source: "rpc",
      method: "dashboard.stats",
      pointer: "/revenue",
    });
    expect(result).toEqual({ value: 1000 });
  });

  it("resolves file bindings via dashboard.data.read matching the real gateway contract", async () => {
    // The gateway's dashboard.data.read readParams whitelist accepts ONLY `binding`
    // and resolves the file + applies the JSON pointer server-side, returning the
    // final value under `data`. The client must send the whole binding and must not
    // re-apply the pointer; a regression to `{ path, pointer }` + re-apply fails here.
    const request = vi.fn(async () => ({ data: 7 }));
    const transport = mockTransport({ request: request as never });
    const result = await resolveBinding(transport, {
      source: "file",
      path: "q3.json",
      pointer: "/q3/total",
    });
    expect(request).toHaveBeenCalledWith("dashboard.data.read", {
      binding: { source: "file", path: "q3.json", pointer: "/q3/total" },
    });
    expect(result).toEqual({ value: 7 });
  });

  it("returns an error result when resolution throws", async () => {
    const transport = mockTransport({
      request: vi.fn(async () => {
        throw new Error("no data");
      }) as never,
    });
    const result = await resolveBinding(transport, { source: "rpc", method: "x" });
    expect(result).toEqual({ error: "no data" });
  });
});

describe("computed binding resolution", () => {
  it("reduces numeric inputs per op", () => {
    expect(resolveComputedBinding("sum", [1, 2, 3])).toEqual({ value: 6 });
    expect(resolveComputedBinding("avg", [1, 2, 3])).toEqual({ value: 2 });
    expect(resolveComputedBinding("min", [3, 1, 2])).toEqual({ value: 1 });
    expect(resolveComputedBinding("max", [3, 1, 2])).toEqual({ value: 3 });
  });

  it("flattens array inputs when reducing and counting", () => {
    expect(resolveComputedBinding("sum", [[1, 2], 3])).toEqual({ value: 6 });
    expect(resolveComputedBinding("count", [[1, 2, 3]])).toEqual({ value: 3 });
    expect(resolveComputedBinding("count", [1, 2])).toEqual({ value: 2 });
  });

  it("returns 0 for an empty sum and null for empty avg/min/max", () => {
    expect(resolveComputedBinding("sum", [])).toEqual({ value: 0 });
    expect(resolveComputedBinding("avg", [])).toEqual({ value: null });
    expect(resolveComputedBinding("min", [])).toEqual({ value: null });
    expect(resolveComputedBinding("max", [])).toEqual({ value: null });
  });

  it("last returns the final input value", () => {
    expect(resolveComputedBinding("last", [1, 2, "z"])).toEqual({ value: "z" });
    expect(resolveComputedBinding("last", [])).toEqual({ value: null });
  });

  it("picks a JSON pointer from the first input", () => {
    expect(resolveComputedBinding("pick", [{ a: { b: 7 } }], "/a/b")).toEqual({ value: 7 });
  });

  it("format interpolates indexed placeholders without eval", () => {
    expect(resolveComputedBinding("format", [42, "USD"], "{0} {1}")).toEqual({ value: "42 USD" });
    // Missing placeholders collapse to empty; objects stringify to JSON.
    expect(resolveComputedBinding("format", [{ x: 1 }], "v={0} m={9}")).toEqual({
      value: 'v={"x":1} m=',
    });
  });

  it("rejects an unknown op with an error result", () => {
    expect(resolveComputedBinding("danger", [1])).toEqual({
      error: expect.stringContaining("Unknown computed op"),
    });
  });
});

describe("stream binding subscription", () => {
  it("subscribes to the allowlisted channel, pushes with the pointer applied, and unsubscribes", () => {
    let handler: ((payload: unknown) => void) | null = null;
    let subscribedEvent: string | null = null;
    const unsubscribe = vi.fn();
    const transport = mockTransport({
      addEventListener: vi.fn((event: string, fn: (payload: unknown) => void) => {
        subscribedEvent = event;
        handler = fn;
        return unsubscribe;
      }) as never,
    });
    const results: unknown[] = [];
    const dispose = subscribeToStreamBinding(
      transport,
      { source: "stream", event: "presence", pointer: "/online" },
      (result) => {
        if ("value" in result) {
          results.push(result.value);
        }
      },
    );
    expect(subscribedEvent).toBe("presence");
    expect(handler).not.toBeNull();
    // Delivered event → pushed (pointer applied).
    handler!({ online: 5 });
    expect(results).toEqual([5]);

    dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("refuses a non-allowlisted event channel without subscribing", () => {
    const addEventListener = vi.fn(() => () => {});
    const transport = mockTransport({ addEventListener: addEventListener as never });
    const dispose = subscribeToStreamBinding(
      transport,
      { source: "stream", event: "evil.channel" },
      () => {},
    );
    expect(addEventListener).not.toHaveBeenCalled();
    dispose();
  });
});

describe("active drag cancellation", () => {
  it("cancels a registered drag from stopDashboard", () => {
    const host = {};
    const cancel = vi.fn();
    registerActiveDrag(host, cancel);
    stopDashboard(host);
    expect(cancel).toHaveBeenCalledTimes(1);
    // Idempotent: a second stop does not re-invoke the (already cleared) teardown.
    stopDashboard(host);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels the prior drag when a new one registers on the same host", () => {
    const host = {};
    const first = vi.fn();
    const second = vi.fn();
    registerActiveDrag(host, first);
    registerActiveDrag(host, second);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    cancelActiveDrag(host);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not cancel a drag that already settled and cleared itself", () => {
    const host = {};
    const cancel = vi.fn();
    registerActiveDrag(host, cancel);
    clearActiveDrag(host); // normal pointerup path clears without cancelling
    stopDashboard(host);
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe("data-refresh polling", () => {
  it("ticks on the interval while the document is visible", () => {
    vi.useFakeTimers();
    try {
      const host = {};
      const onTick = vi.fn();
      startBindingPolling(host, mockTransport(), onTick, 10_000);
      vi.advanceTimersByTime(30_000);
      expect(onTick).toHaveBeenCalledTimes(3);
      stopBindingPolling(host);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops ticking after stopDashboard — no orphan timer", () => {
    vi.useFakeTimers();
    try {
      const host = {};
      const onTick = vi.fn();
      startBindingPolling(host, mockTransport(), onTick, 10_000);
      vi.advanceTimersByTime(10_000);
      expect(onTick).toHaveBeenCalledTimes(1);
      stopDashboard(host); // tab-leave / disconnect
      vi.advanceTimersByTime(60_000);
      expect(onTick).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is idempotent — a re-render does not stack timers", () => {
    vi.useFakeTimers();
    try {
      const host = {};
      const onTick = vi.fn();
      startBindingPolling(host, mockTransport(), onTick, 10_000);
      startBindingPolling(host, mockTransport(), onTick, 10_000);
      vi.advanceTimersByTime(10_000);
      expect(onTick).toHaveBeenCalledTimes(1);
      stopBindingPolling(host);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the tick when the document is hidden", () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      const host = {};
      const onTick = vi.fn();
      startBindingPolling(host, mockTransport(), onTick, 10_000);
      vi.advanceTimersByTime(30_000);
      expect(onTick).not.toHaveBeenCalled();
      stopBindingPolling(host);
    } finally {
      visibility.mockRestore();
      vi.useRealTimers();
    }
  });

  it("a null transport stops any running timer", () => {
    vi.useFakeTimers();
    try {
      const host = {};
      const onTick = vi.fn();
      startBindingPolling(host, mockTransport(), onTick, 10_000);
      startBindingPolling(host, null, onTick, 10_000); // disconnect
      vi.advanceTimersByTime(30_000);
      expect(onTick).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps sub-10s intervals up to the 10s floor", () => {
    vi.useFakeTimers();
    try {
      const host = {};
      const onTick = vi.fn();
      startBindingPolling(host, mockTransport(), onTick, 1_000);
      vi.advanceTimersByTime(9_000);
      expect(onTick).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1_000);
      expect(onTick).toHaveBeenCalledTimes(1);
      stopBindingPolling(host);
    } finally {
      vi.useRealTimers();
    }
  });

  it("exposes a sane default interval within the spec window", () => {
    expect(DASHBOARD_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(30_000);
    expect(DASHBOARD_POLL_INTERVAL_MS).toBeLessThanOrEqual(60_000);
  });
});

describe("exportWorkspace", () => {
  it("fetches the strict doc from the gateway and serializes it", async () => {
    const request = vi.fn(async () => ({ doc: sampleDoc, workspaceVersion: 3 }));
    const transport = mockTransport({ request: request as never });
    const file = await exportWorkspace(transport);
    expect(request).toHaveBeenCalledWith("dashboard.workspace.get", {});
    expect(file.filename).toMatch(/^dashboard-workspace-.*\.json$/);
    expect(JSON.parse(file.json)).toEqual(sampleDoc);
  });

  it("throws when disconnected", async () => {
    await expect(exportWorkspace(null)).rejects.toThrow(/connected/i);
  });
});

describe("importWorkspace", () => {
  it("sanitizes custom widgets to pending then applies via workspace.replace", async () => {
    const host = {};
    const state = getDashboardState(host);
    const request = vi.fn(async (method: string, _params?: unknown) =>
      method === "dashboard.workspace.get" ? { doc: sampleDoc, workspaceVersion: 3 } : {},
    );
    const transport = mockTransport({ request: request as never });
    const imported = {
      schemaVersion: 1,
      workspaceVersion: 0,
      tabs: [
        {
          slug: "main",
          title: "Main",
          hidden: false,
          createdBy: "user",
          widgets: [
            {
              id: "cw",
              kind: "custom:charts",
              grid: { x: 0, y: 0, w: 4, h: 2 },
              collapsed: false,
              hidden: false,
            },
          ],
        },
      ],
      widgetsRegistry: { charts: { status: "approved", createdBy: "agent:x", approvedBy: "user" } },
      prefs: { tabOrder: ["main"] },
    };
    const ok = await importWorkspace(state, transport, JSON.stringify(imported));
    expect(ok).toBe(true);
    const replaceCall = request.mock.calls.find(
      (call) => call[0] === "dashboard.workspace.replace",
    );
    expect(replaceCall).toBeDefined();
    const sentDoc = (replaceCall![1] as { doc: { widgetsRegistry: Record<string, unknown> } }).doc;
    // NEVER auto-approve an imported custom widget.
    expect(sentDoc.widgetsRegistry.charts).toEqual({ status: "pending", createdBy: "agent:x" });
    expect(state.actionError).toBeNull();
  });

  it("surfaces a validation failure from the gateway as an action error", async () => {
    const host = {};
    const state = getDashboardState(host);
    const request = vi.fn(async (method: string) => {
      if (method === "dashboard.workspace.replace") {
        throw new Error("tabs[0].slug is invalid");
      }
      return {};
    });
    const transport = mockTransport({ request: request as never });
    const ok = await importWorkspace(state, transport, JSON.stringify({ tabs: [{ slug: "BAD" }] }));
    expect(ok).toBe(false);
    expect(state.actionError).toContain("slug is invalid");
  });

  it("rejects malformed JSON with an action error", async () => {
    const host = {};
    const state = getDashboardState(host);
    const transport = mockTransport();
    const ok = await importWorkspace(state, transport, "{not json");
    expect(ok).toBe(false);
    expect(state.actionError).toMatch(/valid JSON/);
  });
});
