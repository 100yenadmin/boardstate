import { describe, expect, it, vi } from "vitest";
import type { Transport } from "@boardstate/core";
import {
  DASHBOARD_PRESENCE_TTL_MS,
  clearPresence,
  pingPresence,
  presenceForTab,
  recordPresence,
} from "./presence.js";

function mockTransport(overrides: Partial<Transport> = {}): Transport {
  return {
    request: vi.fn(async () => ({})),
    addEventListener: vi.fn(() => () => {}),
    ...overrides,
  } as unknown as Transport;
}

describe("presence", () => {
  const t0 = 100_000;

  it("records a ping and lists operators viewing a tab, freshest first", () => {
    const host = {};
    clearPresence(host);
    recordPresence(host, { operator: "device:a", tabSlug: "ops", at: t0 }, t0);
    recordPresence(host, { operator: "device:b", tabSlug: "ops", at: t0 + 10 }, t0 + 10);
    recordPresence(host, { operator: "device:c", tabSlug: "other", at: t0 + 10 }, t0 + 10);
    expect(presenceForTab(host, "ops", t0 + 20)).toEqual(["device:b", "device:a"]);
    expect(presenceForTab(host, "other", t0 + 20)).toEqual(["device:c"]);
  });

  it("drops stale pings past the TTL", () => {
    const host = {};
    clearPresence(host);
    recordPresence(host, { operator: "device:a", tabSlug: "ops", at: t0 }, t0);
    expect(presenceForTab(host, "ops", t0 + DASHBOARD_PRESENCE_TTL_MS + 1)).toEqual([]);
  });

  it("excludes this client's own echo from the indicators", () => {
    const host = {};
    clearPresence(host);
    const request = vi.fn(async () => ({}));
    const transport = mockTransport({ request: request as never });
    pingPresence(host, transport, "ops");
    expect(request).toHaveBeenCalledWith("dashboard.presence.ping", { tabSlug: "ops" });
    // The server echoes our own ping back to us as device:self — it must not show.
    recordPresence(host, { operator: "device:self", tabSlug: "ops", at: t0 }, t0);
    recordPresence(host, { operator: "device:other", tabSlug: "ops", at: t0 + 100 }, t0 + 100);
    expect(presenceForTab(host, "ops", t0 + 200)).toEqual(["device:other"]);
  });

  it("clears all presence for a host on teardown", () => {
    const host = {};
    clearPresence(host);
    recordPresence(host, { operator: "device:a", tabSlug: "ops", at: t0 }, t0);
    expect(presenceForTab(host, "ops", t0 + 10)).toEqual(["device:a"]);
    clearPresence(host);
    expect(presenceForTab(host, "ops", t0 + 10)).toEqual([]);
  });
});
