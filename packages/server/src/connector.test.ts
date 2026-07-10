// The connector contract's teeth: reads register with scope "read" and answer with
// fresh values; streams broadcast on their interval and stop() ends them; every
// non-allowlisted name (and boardstate.changed) is refused ATOMICALLY — nothing
// registers when any part of the definition is out of contract.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardStore, MemoryStorageAdapter } from "@boardstate/core";
import { createInProcessHost } from "./host.js";
import { installConnector, type ConnectorHandle } from "./connector.js";

function makeHost() {
  const storage = new MemoryStorageAdapter();
  const store = new DashboardStore({ storage });
  return createInProcessHost(store, storage);
}

describe("installConnector", () => {
  let handle: ConnectorHandle | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    handle?.stop();
    handle = null;
    vi.useRealTimers();
  });

  it("registers allowlisted reads that resolve fresh values per request", async () => {
    const host = makeHost();
    let calls = 0;
    handle = installConnector(host, {
      reads: { "usage.cost": () => ({ totals: { totalCost: ++calls } }) },
    });
    expect(await host.request("usage.cost")).toEqual({ totals: { totalCost: 1 } });
    expect(await host.request("usage.cost")).toEqual({ totals: { totalCost: 2 } });
  });

  it("broadcasts stream payloads on the interval and stop() ends them", () => {
    const host = makeHost();
    const seen: unknown[] = [];
    host.addEventListener("presence", (payload) => seen.push(payload));
    let tick = 0;
    handle = installConnector(host, {
      streams: [{ event: "presence", intervalMs: 1000, payload: () => ({ tick: ++tick }) }],
    });
    vi.advanceTimersByTime(3100);
    expect(seen).toEqual([{ tick: 1 }, { tick: 2 }, { tick: 3 }]);
    handle.stop();
    vi.advanceTimersByTime(5000);
    expect(seen).toHaveLength(3);
  });

  it("refuses non-allowlisted reads and streams ATOMICALLY (nothing registers)", async () => {
    const host = makeHost();
    expect(() =>
      installConnector(host, {
        reads: { "usage.cost": () => 1, "secrets.dump": () => 2 },
      }),
    ).toThrow("DATA_READ_RPC_ALLOWLIST");
    // The valid read in the same bad definition did NOT register.
    await expect(host.request("usage.cost")).rejects.toThrow();

    expect(() =>
      installConnector(host, {
        streams: [{ event: "evil.channel", intervalMs: 1000, payload: () => 1 }],
      }),
    ).toThrow("STREAM_EVENT_ALLOWLIST");
  });

  it("refuses boardstate.changed as a stream channel", () => {
    const host = makeHost();
    expect(() =>
      installConnector(host, {
        streams: [{ event: "boardstate.changed", intervalMs: 1000, payload: () => 1 }],
      }),
    ).toThrow("boardstate.changed");
  });

  it("answers a throwing read with a connector_error instead of crashing", async () => {
    const host = makeHost();
    handle = installConnector(host, {
      reads: {
        "usage.cost": () => {
          throw new Error("upstream API down");
        },
      },
    });
    await expect(host.request("usage.cost")).rejects.toThrow("upstream API down");
  });
});
