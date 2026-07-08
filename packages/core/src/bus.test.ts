import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  nextSubscriberId,
  publish,
  resetBusForTest,
  subscribe,
  unsubscribe,
  unsubscribeAll,
} from "./bus.js";

beforeEach(() => {
  resetBusForTest();
});

describe("nextSubscriberId", () => {
  it("mints distinct, broker-assigned ids", () => {
    const a = nextSubscriberId();
    const b = nextSubscriberId();
    expect(a).not.toEqual(b);
  });
});

describe("same-tab delivery", () => {
  it("delivers a publish to every OTHER same-tab subscriber on the channel", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribe({ tabSlug: "t1", channel: "filter", subscriberId: "a", deliver: a });
    subscribe({ tabSlug: "t1", channel: "filter", subscriberId: "b", deliver: b });
    const delivered = publish({
      tabSlug: "t1",
      channel: "filter",
      fromSubscriberId: "a",
      payload: { q: "x" },
    });
    expect(delivered).toBe(1);
    expect(a).not.toHaveBeenCalled(); // publisher excluded
    expect(b).toHaveBeenCalledWith("filter", { q: "x" });
  });

  it("only delivers to subscribers of the SAME channel", () => {
    const other = vi.fn();
    subscribe({ tabSlug: "t1", channel: "other", subscriberId: "b", deliver: other });
    expect(publish({ tabSlug: "t1", channel: "filter", fromSubscriberId: "a", payload: 1 })).toBe(
      0,
    );
    expect(other).not.toHaveBeenCalled();
  });
});

describe("cross-tab isolation", () => {
  it("never delivers a tab-A publish to a tab-B subscriber", () => {
    const onTabB = vi.fn();
    subscribe({ tabSlug: "tabB", channel: "filter", subscriberId: "b", deliver: onTabB });
    const delivered = publish({
      tabSlug: "tabA",
      channel: "filter",
      fromSubscriberId: "a",
      payload: { secret: true },
    });
    expect(delivered).toBe(0);
    expect(onTabB).not.toHaveBeenCalled();
  });

  it("keeps identical channel names on different tabs independent", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribe({ tabSlug: "tabA", channel: "c", subscriberId: "sa", deliver: a });
    subscribe({ tabSlug: "tabB", channel: "c", subscriberId: "sb", deliver: b });
    publish({ tabSlug: "tabA", channel: "c", fromSubscriberId: "pub", payload: "hi" });
    expect(a).toHaveBeenCalledWith("c", "hi");
    expect(b).not.toHaveBeenCalled();
  });
});

describe("unsubscribe teardown", () => {
  it("stops delivery after the returned unsubscribe fn is called", () => {
    const deliver = vi.fn();
    const off = subscribe({ tabSlug: "t1", channel: "c", subscriberId: "s", deliver });
    off();
    expect(publish({ tabSlug: "t1", channel: "c", fromSubscriberId: "p", payload: 1 })).toBe(0);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("unsubscribe() removes exactly one (tab, channel, subscriber) triple", () => {
    const keep = vi.fn();
    subscribe({ tabSlug: "t1", channel: "c", subscriberId: "keep", deliver: keep });
    subscribe({ tabSlug: "t1", channel: "c", subscriberId: "drop", deliver: vi.fn() });
    unsubscribe({ tabSlug: "t1", channel: "c", subscriberId: "drop" });
    expect(publish({ tabSlug: "t1", channel: "c", fromSubscriberId: "p", payload: 1 })).toBe(1);
    expect(keep).toHaveBeenCalledOnce();
  });

  it("unsubscribeAll() drops every channel a widget held on its tab", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribe({ tabSlug: "t1", channel: "c1", subscriberId: "s", deliver: a });
    subscribe({ tabSlug: "t1", channel: "c2", subscriberId: "s", deliver: b });
    unsubscribeAll("t1", "s");
    publish({ tabSlug: "t1", channel: "c1", fromSubscriberId: "p", payload: 1 });
    publish({ tabSlug: "t1", channel: "c2", fromSubscriberId: "p", payload: 1 });
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });
});

describe("idempotent subscribe", () => {
  it("re-subscribing the same triple does not stack duplicate deliveries", () => {
    const deliver = vi.fn();
    subscribe({ tabSlug: "t1", channel: "c", subscriberId: "s", deliver });
    subscribe({ tabSlug: "t1", channel: "c", subscriberId: "s", deliver });
    expect(publish({ tabSlug: "t1", channel: "c", fromSubscriberId: "p", payload: 1 })).toBe(1);
    expect(deliver).toHaveBeenCalledOnce();
  });
});

describe("re-entrant (un)subscribe during delivery", () => {
  it("uses a stable snapshot so a handler mutating the set is safe", () => {
    const a = vi.fn(() => {
      // Subscriber a unsubscribes itself mid-delivery; must not affect this fan-out.
      unsubscribe({ tabSlug: "t1", channel: "c", subscriberId: "a" });
    });
    const b = vi.fn();
    subscribe({ tabSlug: "t1", channel: "c", subscriberId: "a", deliver: a });
    subscribe({ tabSlug: "t1", channel: "c", subscriberId: "b", deliver: b });
    expect(publish({ tabSlug: "t1", channel: "c", fromSubscriberId: "p", payload: 1 })).toBe(2);
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });
});
