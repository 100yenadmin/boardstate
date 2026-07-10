// The connector contract's teeth (SPEC §16 + §17). A connector self-declares its
// allowlisted reads/streams; they land as a `requested` grant and serve NOTHING until
// an operator approves. Every non-allowlisted name (and boardstate.changed) is refused
// atomically. Revoke stops the data immediately.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardStore, MemoryStorageAdapter } from "@boardstate/core";
import { createInProcessHost, nodeRpcDeps, registerBoardstateRpc } from "./node.js";
import { installConnector, type ConnectorHandle } from "./connector.js";

function makeHostAndStore() {
  const storage = new MemoryStorageAdapter();
  const store = new DashboardStore({ storage });
  const host = createInProcessHost(store, storage);
  registerBoardstateRpc(host, { store, ...nodeRpcDeps() });
  return { host, store };
}

/** Approve a connector's capability through the operator RPC. */
async function grant(
  host: ReturnType<typeof createInProcessHost>,
  name: string,
  decision = "granted",
) {
  await host.request("dashboard.capability.approve", { name, decision, actor: "user" });
}

describe("installConnector — grant lifecycle (§17)", () => {
  let handle: ConnectorHandle | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    handle?.stop();
    handle = null;
    vi.useRealTimers();
  });

  it("registers a `requested` grant on install and serves NOTHING until granted", async () => {
    const { host, store } = makeHostAndStore();
    let calls = 0;
    handle = installConnector(host, {
      name: "metrics",
      store,
      description: "machine metrics",
      reads: { "usage.cost": () => ({ totals: { totalCost: ++calls } }) },
    });
    // Let the install mutation land, then inspect the grant.
    await vi.advanceTimersByTimeAsync(0);
    const doc = await store.read();
    expect(doc.capabilitiesRegistry?.metrics).toMatchObject({
      status: "requested",
      methods: ["usage.cost"],
    });

    // Ungranted: the read is refused with capability_pending, resolver never runs.
    await expect(host.request("usage.cost")).rejects.toThrow(/awaiting operator approval/);
    expect(calls).toBe(0);

    // Operator approves → the read now serves fresh values per request.
    await grant(host, "metrics");
    expect(await host.request("usage.cost")).toEqual({ totals: { totalCost: 1 } });
    expect(await host.request("usage.cost")).toEqual({ totals: { totalCost: 2 } });
  });

  it("only broadcasts stream payloads once granted, and stops on revoke", async () => {
    const { host, store } = makeHostAndStore();
    const seen: unknown[] = [];
    host.addEventListener("presence", (payload) => seen.push(payload));
    let tick = 0;
    handle = installConnector(host, {
      name: "live",
      store,
      streams: [{ event: "presence", intervalMs: 1000, payload: () => ({ tick: ++tick }) }],
    });
    await vi.advanceTimersByTimeAsync(0);

    // Ungranted: ticks fire but nothing is broadcast.
    await vi.advanceTimersByTimeAsync(3000);
    expect(seen).toHaveLength(0);

    await grant(host, "live");
    await vi.advanceTimersByTimeAsync(2000);
    expect(seen.length).toBeGreaterThanOrEqual(1);

    // Revoke → the next tick broadcasts nothing.
    const countAtRevoke = seen.length;
    await grant(host, "live", "revoked");
    await vi.advanceTimersByTimeAsync(3000);
    expect(seen.length).toBe(countAtRevoke);
  });

  it("refuses non-allowlisted reads and streams ATOMICALLY (nothing registers)", async () => {
    const { host, store } = makeHostAndStore();
    expect(() =>
      installConnector(host, {
        name: "bad",
        store,
        reads: { "usage.cost": () => 1, "secrets.dump": () => 2 },
      }),
    ).toThrow("DATA_READ_RPC_ALLOWLIST");
    await expect(host.request("usage.cost")).rejects.toThrow();

    expect(() =>
      installConnector(host, {
        name: "bad2",
        store,
        streams: [{ event: "evil.channel", intervalMs: 1000, payload: () => 1 }],
      }),
    ).toThrow("STREAM_EVENT_ALLOWLIST");
  });

  it("refuses boardstate.changed as a stream channel and an invalid connector name", async () => {
    const { host, store } = makeHostAndStore();
    expect(() =>
      installConnector(host, {
        name: "live",
        store,
        streams: [{ event: "boardstate.changed", intervalMs: 1000, payload: () => 1 }],
      }),
    ).toThrow("boardstate.changed");
    expect(() => installConnector(host, { name: "bad name!", store, reads: {} })).toThrow(
      "connector name",
    );
  });

  it("dashboard.capability.approve is refused for an unknown connector", async () => {
    const { host } = makeHostAndStore();
    await expect(
      host.request("dashboard.capability.approve", {
        name: "nope",
        decision: "granted",
        actor: "user",
      }),
    ).rejects.toThrow(/no capability request/);
  });

  it("without a store, keeps the pre-§17 behavior (serves immediately)", async () => {
    const { host } = makeHostAndStore();
    handle = installConnector(host, {
      name: "legacy",
      reads: { "usage.cost": () => ({ ok: true }) },
    });
    expect(await host.request("usage.cost")).toEqual({ ok: true });
  });
});
