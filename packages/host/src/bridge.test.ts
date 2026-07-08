import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardWidgetCapability, WidgetManifestView } from "@boardstate/core";
import {
  createWidgetBridge,
  dispatchRateLimitedPrompt,
  isRpcMethodAllowed,
  isWellFormedInbound,
  resetBusRateStatesForTest,
  resetPromptRateStatesForTest,
  type WidgetBridgeDeps,
  type WidgetBusBridge,
  type WidgetErrorCode,
  type WidgetOutboundMessage,
} from "./bridge.js";

beforeEach(() => {
  // Rate-limit state is module-level (keyed by widget name); reset between tests.
  resetPromptRateStatesForTest();
  resetBusRateStatesForTest();
});

function manifest(
  overrides?: Partial<Omit<WidgetManifestView, "capabilities">> & { capabilities?: string[] },
): WidgetManifestView {
  const { capabilities, ...rest } = overrides ?? {};
  return {
    name: "revenue-chart",
    bindingIds: ["value"],
    capabilities: (capabilities ?? ["data:read"]) as DashboardWidgetCapability[],
    ...rest,
  };
}

function makeBridge(overrides?: Partial<WidgetBridgeDeps>) {
  const posted: WidgetOutboundMessage[] = [];
  const deps: WidgetBridgeDeps = {
    manifest: manifest(),
    resolveBinding: async () => ({ ok: true }),
    resolveTheme: () => ({ "--accent": "#ff0000" }),
    confirmPrompt: async () => true,
    sendPrompt: async () => undefined,
    post: (message) => posted.push(message),
    ...overrides,
  };
  return { bridge: createWidgetBridge(deps), posted };
}

describe("isWellFormedInbound", () => {
  it("accepts a known v1 type", () => {
    expect(isWellFormedInbound({ v: 1, type: "dashboard:ready" })).toBe(true);
  });
  it("rejects a wrong envelope version", () => {
    expect(isWellFormedInbound({ v: 2, type: "dashboard:ready" })).toBe(false);
  });
  it("rejects an unknown type", () => {
    expect(isWellFormedInbound({ v: 1, type: "dashboard:evil" })).toBe(false);
  });
  it("rejects non-objects", () => {
    expect(isWellFormedInbound("nope")).toBe(false);
    expect(isWellFormedInbound(null)).toBe(false);
  });
});

describe("createWidgetBridge accept filter", () => {
  it("drops malformed messages and counts them", () => {
    const { bridge } = makeBridge();
    expect(bridge.handleMessage({ v: 2, type: "dashboard:ready" })).toBe(false);
    expect(bridge.handleMessage({ type: "dashboard:getData" })).toBe(false);
    expect(bridge.handleMessage("garbage")).toBe(false);
    expect(bridge.droppedCount).toBe(3);
  });

  it("accepts a ready handshake", () => {
    const { bridge } = makeBridge();
    expect(bridge.handleMessage({ v: 1, type: "dashboard:ready" })).toBe(true);
    expect(bridge.droppedCount).toBe(0);
  });
});

describe("getData binding gating", () => {
  it("resolves a declared binding and posts data", async () => {
    const { bridge, posted } = makeBridge({ resolveBinding: async () => ({ revenue: 42 }) });
    bridge.handleMessage({ v: 1, type: "dashboard:getData", requestId: "r1", bindingId: "value" });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      v: 1,
      type: "dashboard:data",
      requestId: "r1",
      bindingId: "value",
      data: { revenue: 42 },
    });
  });

  it("denies an undeclared binding with binding_denied and never calls the resolver", async () => {
    const resolveBinding = vi.fn(async () => ({ ok: true }));
    const { bridge, posted } = makeBridge({ resolveBinding });
    bridge.handleMessage({ v: 1, type: "dashboard:getData", requestId: "r1", bindingId: "secret" });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      type: "dashboard:error",
      code: "binding_denied",
      requestId: "r1",
    });
    expect(resolveBinding).not.toHaveBeenCalled();
  });

  it("posts a timeout error when the resolver overruns getDataTimeoutMs", async () => {
    vi.useFakeTimers();
    try {
      const { bridge, posted } = makeBridge({
        getDataTimeoutMs: 10_000,
        resolveBinding: () => new Promise(() => {}),
      });
      bridge.handleMessage({
        v: 1,
        type: "dashboard:getData",
        requestId: "r1",
        bindingId: "value",
      });
      await vi.advanceTimersByTimeAsync(10_001);
      expect(posted[0]).toMatchObject({
        type: "dashboard:error",
        code: "timeout",
        requestId: "r1",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("getTheme", () => {
  it("returns the theme tokens", () => {
    const { bridge, posted } = makeBridge({ resolveTheme: () => ({ "--bg": "#000" }) });
    bridge.handleMessage({ v: 1, type: "dashboard:getTheme", requestId: "t1" });
    expect(posted[0]).toEqual({
      v: 1,
      type: "dashboard:theme",
      requestId: "t1",
      tokens: { "--bg": "#000" },
    });
  });
});

describe("sendPrompt capability + confirm + rate limit", () => {
  it("denies without a dialog when the capability is absent", async () => {
    const confirmPrompt = vi.fn(async () => true);
    const sendPrompt = vi.fn(async () => undefined);
    const { bridge, posted } = makeBridge({
      manifest: manifest({ capabilities: ["data:read"] }),
      confirmPrompt,
      sendPrompt,
    });
    bridge.handleMessage({ v: 1, type: "dashboard:sendPrompt", requestId: "p1", text: "hi" });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ type: "dashboard:error", code: "capability_denied" });
    expect(confirmPrompt).not.toHaveBeenCalled();
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it("shows the dialog and sends nothing when the operator declines", async () => {
    const sendPrompt = vi.fn(async () => undefined);
    const { bridge, posted } = makeBridge({
      manifest: manifest({ capabilities: ["data:read", "prompt:send"] }),
      confirmPrompt: async () => false,
      sendPrompt,
    });
    bridge.handleMessage({ v: 1, type: "dashboard:sendPrompt", requestId: "p1", text: "hi" });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ type: "dashboard:error", code: "prompt_declined" });
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it("sends exactly once when the operator confirms", async () => {
    const sendPrompt = vi.fn(async () => undefined);
    const confirmPrompt = vi.fn(async () => true);
    const { bridge } = makeBridge({
      manifest: manifest({ capabilities: ["prompt:send"] }),
      confirmPrompt,
      sendPrompt,
    });
    bridge.handleMessage({ v: 1, type: "dashboard:sendPrompt", requestId: "p1", text: "do it" });
    await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalledTimes(1));
    expect(confirmPrompt).toHaveBeenCalledWith("do it");
    expect(sendPrompt).toHaveBeenCalledWith("do it");
  });

  it("rate-limits to at most one in-flight prompt", async () => {
    let resolveConfirm!: (ok: boolean) => void;
    const { bridge, posted } = makeBridge({
      manifest: manifest({ capabilities: ["prompt:send"] }),
      confirmPrompt: () =>
        new Promise<boolean>((resolve) => {
          resolveConfirm = resolve;
        }),
    });
    bridge.handleMessage({ v: 1, type: "dashboard:sendPrompt", requestId: "p1", text: "one" });
    // Second request while the first confirm is still pending → rate_limited.
    bridge.handleMessage({ v: 1, type: "dashboard:sendPrompt", requestId: "p2", text: "two" });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      type: "dashboard:error",
      code: "rate_limited",
      requestId: "p2",
    });
    resolveConfirm(false);
  });

  it("rate-limits to 10 sends per minute", async () => {
    const clock = 0;
    let sent = 0;
    const { bridge, posted } = makeBridge({
      manifest: manifest({ capabilities: ["prompt:send"] }),
      confirmPrompt: async () => true,
      sendPrompt: async () => {
        sent += 1;
      },
      now: () => clock,
    });
    // Fire sequentially, awaiting each send so `promptInFlight` clears before the
    // next (the in-flight limit is exercised by a separate test).
    for (let i = 0; i < 10; i += 1) {
      bridge.handleMessage({ v: 1, type: "dashboard:sendPrompt", requestId: `p${i}`, text: "x" });
      await vi.waitFor(() => expect(sent).toBe(i + 1));
    }
    expect(posted).toHaveLength(0);
    // The 11th within the same rolling minute is rejected.
    bridge.handleMessage({ v: 1, type: "dashboard:sendPrompt", requestId: "p10", text: "x" });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ type: "dashboard:error", code: "rate_limited" });
    expect(sent).toBe(10);
  });
});

describe("dispatchRateLimitedPrompt (shared confirm + rate gate)", () => {
  it("sends after an operator confirm", async () => {
    const sendPrompt = vi.fn(async () => undefined);
    const outcome = await dispatchRateLimitedPrompt({
      widgetKey: "af-1",
      text: "deploy",
      confirmPrompt: async () => true,
      sendPrompt,
    });
    expect(outcome).toBe("sent");
    expect(sendPrompt).toHaveBeenCalledWith("deploy");
  });

  it("sends nothing when the operator declines", async () => {
    const sendPrompt = vi.fn(async () => undefined);
    const outcome = await dispatchRateLimitedPrompt({
      widgetKey: "af-1",
      text: "deploy",
      confirmPrompt: async () => false,
      sendPrompt,
    });
    expect(outcome).toBe("declined");
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it("rate-limits a second in-flight dispatch for the same key", async () => {
    let resolveConfirm!: (ok: boolean) => void;
    const first = dispatchRateLimitedPrompt({
      widgetKey: "af-1",
      text: "one",
      confirmPrompt: () =>
        new Promise<boolean>((resolve) => {
          resolveConfirm = resolve;
        }),
      sendPrompt: async () => undefined,
    });
    const second = await dispatchRateLimitedPrompt({
      widgetKey: "af-1",
      text: "two",
      confirmPrompt: async () => true,
      sendPrompt: async () => undefined,
    });
    expect(second).toBe("rate_limited");
    resolveConfirm(false);
    expect(await first).toBe("declined");
  });

  it("shares the SAME budget with the bridge's sendPrompt for the same widget key", async () => {
    const clock = 5_000_000;
    let sent = 0;
    // Exhaust the per-minute budget for key "shared" via the standalone gate.
    for (let i = 0; i < 10; i += 1) {
      const outcome = await dispatchRateLimitedPrompt({
        widgetKey: "shared",
        text: "x",
        confirmPrompt: async () => true,
        sendPrompt: async () => {
          sent += 1;
        },
        now: () => clock,
      });
      expect(outcome).toBe("sent");
    }
    expect(sent).toBe(10);
    // A bridge for a widget NAMED "shared" now hits the same exhausted budget.
    const posted: WidgetOutboundMessage[] = [];
    const bridge = createWidgetBridge({
      manifest: manifest({ name: "shared", capabilities: ["prompt:send"] }),
      resolveBinding: async () => null,
      resolveTheme: () => ({}),
      confirmPrompt: async () => true,
      sendPrompt: async () => {
        sent += 1;
      },
      post: (message) => posted.push(message),
      now: () => clock,
    });
    bridge.handleMessage({ v: 1, type: "dashboard:sendPrompt", requestId: "s0", text: "x" });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ type: "dashboard:error", code: "rate_limited" });
    expect(sent).toBe(10);
  });
});

describe("push", () => {
  it("posts a push for a declared binding", async () => {
    const { bridge, posted } = makeBridge({ resolveBinding: async () => 7 });
    await bridge.push("value");
    expect(posted[0]).toEqual({ v: 1, type: "dashboard:push", bindingId: "value", data: 7 });
  });

  it("ignores a push for an undeclared binding", async () => {
    const { bridge, posted } = makeBridge();
    await bridge.push("secret");
    expect(posted).toHaveLength(0);
  });
});

describe("dispose", () => {
  it("stops handling messages after dispose", () => {
    const { bridge } = makeBridge();
    bridge.dispose();
    expect(bridge.handleMessage({ v: 1, type: "dashboard:ready" })).toBe(false);
  });
});

describe("rate-limit state persists across bridge re-instantiation (remount)", () => {
  // Exhaust the per-minute budget on one bridge, then dispose + recreate a fresh
  // bridge for the SAME widget name (simulating an iframe remount) and assert the
  // budget did NOT reset — the next send is still rate_limited within the window.
  it("keeps the budget for the same widget name after dispose + recreate", async () => {
    const clock = 1_000_000;
    let sent = 0;
    const makeNamed = () => {
      const posted: WidgetOutboundMessage[] = [];
      const bridge = createWidgetBridge({
        manifest: manifest({ name: "remount-widget", capabilities: ["prompt:send"] }),
        resolveBinding: async () => null,
        resolveTheme: () => ({}),
        confirmPrompt: async () => true,
        sendPrompt: async () => {
          sent += 1;
        },
        post: (message) => posted.push(message),
        now: () => clock,
      });
      return { bridge, posted };
    };

    const first = makeNamed();
    for (let i = 0; i < 10; i += 1) {
      first.bridge.handleMessage({
        v: 1,
        type: "dashboard:sendPrompt",
        requestId: `a${i}`,
        text: "x",
      });
      await vi.waitFor(() => expect(sent).toBe(i + 1));
    }
    // Remount: dispose the exhausted bridge and build a fresh one for the same name.
    first.bridge.dispose();
    const second = makeNamed();
    second.bridge.handleMessage({ v: 1, type: "dashboard:sendPrompt", requestId: "b0", text: "x" });
    await vi.waitFor(() => expect(second.posted).toHaveLength(1));
    // Budget survived the remount → still rate_limited, no extra send.
    expect(second.posted[0]).toMatchObject({ type: "dashboard:error", code: "rate_limited" });
    expect(sent).toBe(10);
  });

  it("gives a DIFFERENT widget name its own independent budget", async () => {
    const clock = 2_000_000;
    let sentA = 0;
    let sentB = 0;
    const bridgeA = createWidgetBridge({
      manifest: manifest({ name: "widget-a", capabilities: ["prompt:send"] }),
      resolveBinding: async () => null,
      resolveTheme: () => ({}),
      confirmPrompt: async () => true,
      sendPrompt: async () => {
        sentA += 1;
      },
      post: () => {},
      now: () => clock,
    });
    const postedB: WidgetOutboundMessage[] = [];
    const bridgeB = createWidgetBridge({
      manifest: manifest({ name: "widget-b", capabilities: ["prompt:send"] }),
      resolveBinding: async () => null,
      resolveTheme: () => ({}),
      confirmPrompt: async () => true,
      sendPrompt: async () => {
        sentB += 1;
      },
      post: (message) => postedB.push(message),
      now: () => clock,
    });
    // Exhaust widget-a's budget.
    for (let i = 0; i < 10; i += 1) {
      bridgeA.handleMessage({ v: 1, type: "dashboard:sendPrompt", requestId: `a${i}`, text: "x" });
      await vi.waitFor(() => expect(sentA).toBe(i + 1));
    }
    // widget-b is unaffected — its first send succeeds.
    bridgeB.handleMessage({ v: 1, type: "dashboard:sendPrompt", requestId: "b0", text: "x" });
    await vi.waitFor(() => expect(sentB).toBe(1));
    expect(postedB).toHaveLength(0);
  });
});

describe("pub/sub bus gating (bus:pubsub)", () => {
  function makeFakeBus() {
    const published: { channel: string; payload: unknown }[] = [];
    const subs = new Map<string, (channel: string, payload: unknown) => void>();
    const bus: WidgetBusBridge = {
      publish: (channel, payload) => published.push({ channel, payload }),
      subscribe: (channel, deliver) => {
        subs.set(channel, deliver);
        return () => subs.delete(channel);
      },
    };
    return { bus, published, subs };
  }

  function makeBusBridge(overrides?: Partial<WidgetBridgeDeps>) {
    const { bus, published, subs } = makeFakeBus();
    const { bridge, posted } = makeBridge({
      manifest: manifest({ name: "pubsub-widget", capabilities: ["bus:pubsub"] }),
      bus,
      now: () => 1_000,
      ...overrides,
    });
    return { bridge, posted, published, subs };
  }

  it("forwards a publish for a gated widget to the broker", () => {
    const { bridge, published } = makeBusBridge();
    expect(
      bridge.handleMessage({
        v: 1,
        type: "dashboard:publish",
        channel: "filter",
        payload: { q: 1 },
      }),
    ).toBe(true);
    expect(published).toEqual([{ channel: "filter", payload: { q: 1 } }]);
  });

  it("denies publish AND subscribe for an ungated widget (neither direction works)", () => {
    const { bus, published, subs } = makeFakeBus();
    const { bridge, posted } = makeBridge({
      manifest: manifest({ name: "ungated", capabilities: ["data:read"] }),
      bus,
    });
    bridge.handleMessage({ v: 1, type: "dashboard:publish", channel: "c", payload: 1 });
    bridge.handleMessage({ v: 1, type: "dashboard:subscribe", channel: "c" });
    expect(published).toHaveLength(0);
    expect(subs.size).toBe(0); // never subscribed → can never receive
    expect(posted.filter((m) => m.type === "dashboard:error")).toHaveLength(2);
    expect(posted[0]).toMatchObject({ type: "dashboard:error", code: "capability_denied" });
    expect(posted[1]).toMatchObject({ type: "dashboard:error", code: "capability_denied" });
  });

  it("delivers a broker message to the child as dashboard:message", () => {
    const { bridge, posted, subs } = makeBusBridge();
    bridge.handleMessage({ v: 1, type: "dashboard:subscribe", channel: "filter" });
    expect(subs.size).toBe(1);
    subs.get("filter")?.("filter", { q: "hello" });
    expect(posted[0]).toEqual({
      v: 1,
      type: "dashboard:message",
      channel: "filter",
      payload: { q: "hello" },
    });
  });

  it("subscribe is idempotent per channel", () => {
    const { bridge, subs } = makeBusBridge();
    bridge.handleMessage({ v: 1, type: "dashboard:subscribe", channel: "filter" });
    bridge.handleMessage({ v: 1, type: "dashboard:subscribe", channel: "filter" });
    expect(subs.size).toBe(1);
  });

  it("rejects a publish whose payload exceeds the size cap", () => {
    const { bridge, posted, published } = makeBusBridge();
    const big = "x".repeat(8 * 1024 + 1);
    bridge.handleMessage({ v: 1, type: "dashboard:publish", channel: "c", payload: big });
    expect(published).toHaveLength(0);
    expect(posted[0]).toMatchObject({ type: "dashboard:error", code: "payload_too_large" });
  });

  it("rejects a publish over the rolling-window rate limit", () => {
    const { bridge, posted, published } = makeBusBridge();
    // 60 allowed within the frozen minute, the 61st rejected.
    for (let i = 0; i < 60; i += 1) {
      bridge.handleMessage({ v: 1, type: "dashboard:publish", channel: "c", payload: i });
    }
    expect(published).toHaveLength(60);
    bridge.handleMessage({ v: 1, type: "dashboard:publish", channel: "c", payload: "over" });
    expect(published).toHaveLength(60);
    expect(posted[0]).toMatchObject({ type: "dashboard:error", code: "rate_limited" });
  });

  it("unsubscribe stops delivery for that channel", () => {
    const { bridge, posted, subs } = makeBusBridge();
    bridge.handleMessage({ v: 1, type: "dashboard:subscribe", channel: "filter" });
    bridge.handleMessage({ v: 1, type: "dashboard:unsubscribe", channel: "filter" });
    expect(subs.size).toBe(0);
    expect(posted).toHaveLength(0);
  });

  it("dispose severs every subscription so no dangling delivery reaches the child", () => {
    const { bridge, posted, subs } = makeBusBridge();
    bridge.handleMessage({ v: 1, type: "dashboard:subscribe", channel: "a" });
    bridge.handleMessage({ v: 1, type: "dashboard:subscribe", channel: "b" });
    expect(subs.size).toBe(2);
    bridge.dispose();
    expect(subs.size).toBe(0);
    expect(posted).toHaveLength(0);
  });

  it("drops a publish with a missing/blank channel without forwarding", () => {
    const { bridge, published } = makeBusBridge();
    expect(bridge.handleMessage({ v: 1, type: "dashboard:publish", payload: 1 })).toBe(false);
    expect(
      bridge.handleMessage({ v: 1, type: "dashboard:publish", channel: "  ", payload: 1 }),
    ).toBe(false);
    expect(published).toHaveLength(0);
  });

  it("rejects a publish whose payload is not serializable as malformed", () => {
    const { bridge, posted, published } = makeBusBridge();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    bridge.handleMessage({ v: 1, type: "dashboard:publish", channel: "c", payload: circular });
    expect(published).toHaveLength(0);
    expect(posted[0]).toMatchObject({ type: "dashboard:error", code: "malformed" });
  });
});

describe("resolve-time rpc allowlist re-check (defense-in-depth)", () => {
  // The mirror-vs-schema keep-in-sync guard lives in the conformance suite, which
  // can import both the browser mirror and the schema-side allowlist.
  it("isRpcMethodAllowed accepts allowlisted and rejects non-allowlisted methods", () => {
    expect(isRpcMethodAllowed("sessions.list")).toBe(true);
    expect(isRpcMethodAllowed("sessions.delete")).toBe(false);
    expect(isRpcMethodAllowed("")).toBe(false);
  });

  it("denies a getData whose gate returns a code and NEVER calls resolveBinding", async () => {
    const resolveBinding = vi.fn(async () => ({ ok: true }));
    const assertBindingAllowed = (bindingId: string): WidgetErrorCode | null =>
      bindingId === "value" ? "binding_denied" : null;
    const { bridge, posted } = makeBridge({ resolveBinding, assertBindingAllowed });
    bridge.handleMessage({ v: 1, type: "dashboard:getData", requestId: "r1", bindingId: "value" });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      type: "dashboard:error",
      code: "binding_denied",
      requestId: "r1",
    });
    expect(resolveBinding).not.toHaveBeenCalled();
  });

  it("does not push a binding the gate denies (never calls resolveBinding)", async () => {
    const resolveBinding = vi.fn(async () => 1);
    const { bridge, posted } = makeBridge({
      resolveBinding,
      assertBindingAllowed: () => "binding_denied",
    });
    await bridge.push("value");
    expect(posted).toHaveLength(0);
    expect(resolveBinding).not.toHaveBeenCalled();
  });

  it("allows a getData when the gate returns null", async () => {
    const resolveBinding = vi.fn(async () => 42);
    const { bridge, posted } = makeBridge({
      resolveBinding,
      assertBindingAllowed: () => null,
    });
    bridge.handleMessage({ v: 1, type: "dashboard:getData", requestId: "r1", bindingId: "value" });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ type: "dashboard:data", data: 42 });
    expect(resolveBinding).toHaveBeenCalledOnce();
  });
});
