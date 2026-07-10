// The pending-action engine + tool-grant lifecycle (SPEC §17.1 / §18), driven over a
// FAKE `ActionBroker` (no real MCP) so the engine's own logic — AND-gate, direct
// readOnly execution, parking + confirm/deny/expiry, single-shot terminal states,
// replay refusal, rate limiting, audit, anti-rug-pull re-pend, confirmAndExecute — is
// tested in isolation. The REAL McpBroker + fake-MCP fixture over a WS pair is exercised
// in @boardstate/broker (broker-actions.wire.test.ts).

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardStore } from "@boardstate/core";
import { FsStorageAdapter } from "@boardstate/core/node";
import { createInProcessHost, type InProcessHost } from "./host.js";
import { registerBoardstateRpc } from "./rpc.js";
import { nodeRpcDeps } from "./node.js";
import {
  installBrokerActions,
  type ActionBroker,
  type ActionSettlementResult,
  type ActionToolManifest,
  type ActionToolManifestEntry,
  type BrokerActionsHandle,
  type InstallBrokerActionsOptions,
} from "./broker-actions.js";
import type { PendingActionRecord } from "@boardstate/schema";

/** A tiny in-memory broker: a mutable catalog + a variant map that moves subset hashes. */
class FakeBroker implements ActionBroker {
  readonly calls: Array<{ id: string; args: Record<string, unknown> }> = [];
  private readonly variant = new Map<string, number>();
  private readonly entries: ActionToolManifestEntry[];

  constructor(entries: ActionToolManifestEntry[]) {
    this.entries = entries;
  }

  connectorNames(): string[] {
    return [...new Set(this.entries.map((entry) => entry.connector))];
  }

  async listTools(): Promise<ActionToolManifest> {
    return {
      tools: [...this.entries],
      hash: this.hashToolSubset(
        { tools: this.entries, hash: "" },
        this.entries.map((entry) => entry.id),
      ),
    };
  }

  /** When set, the NEXT callTool suspends on this promise (for interleave tests). */
  private gate: Promise<void> | null = null;
  private releaseGate: (() => void) | null = null;

  /** Arm a one-shot pause: the next callTool blocks until `release()` is called. */
  pauseNextCall(): () => void {
    this.gate = new Promise<void>((resolve) => {
      this.releaseGate = resolve;
    });
    return () => this.releaseGate?.();
  }

  async callTool(
    toolRef: string,
    args: Record<string, unknown> = {},
  ): Promise<{ content: unknown; structuredContent?: unknown }> {
    this.calls.push({ id: toolRef, args });
    if (this.gate) {
      const gate = this.gate;
      this.gate = null;
      await gate;
    }
    if (toolRef.endsWith(":boom")) {
      throw new Error("boom: tool failed");
    }
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, ref: toolRef }) }] };
  }

  hashToolSubset(manifest: ActionToolManifest, toolIds: readonly string[]): string {
    const set = new Set(toolIds);
    const tuples = manifest.tools
      .filter((entry) => set.has(entry.id))
      .map((entry) => [entry.id, entry.readOnly === true, this.variant.get(entry.id) ?? 0] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    // sha256 hex — matches the schema's TOOLS_HASH_PATTERN, like the real broker.
    return createHash("sha256").update(JSON.stringify(tuples)).digest("hex");
  }

  /** Simulate a server-side rug-pull: bump a tool's variant so its subset hash moves. */
  mutateTool(id: string): void {
    this.variant.set(id, (this.variant.get(id) ?? 0) + 1);
  }
}

let store: DashboardStore;
let host: InProcessHost;
let handle: BrokerActionsHandle | null = null;
let broker: FakeBroker;
let stateDir: string;
let actionEvents: Array<{ id: string; status: string; autoConfirmed?: boolean }>;

type SetupOpts = {
  ttlMs?: number;
  invokeRateMax?: number;
  perAgentInvokeRateMax?: number;
  /** Injected clock (ms), threaded into the store sweep, engine, AND rpc future-dating. */
  now?: () => number;
  grantSweepMs?: InstallBrokerActionsOptions["grantSweepMs"];
  onActionSettled?: InstallBrokerActionsOptions["onActionSettled"];
};

async function setup(entries: ActionToolManifestEntry[], opts: SetupOpts = {}): Promise<void> {
  const { now, ...rest } = opts;
  stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "boardstate-actions-"));
  const storage = new FsStorageAdapter({ storageDir: stateDir });
  store = new DashboardStore({ storage, ...(now ? { now } : {}) });
  host = createInProcessHost(store, storage);
  broker = new FakeBroker(entries);
  handle = installBrokerActions(host, {
    broker,
    store,
    // Disable the real-timer sweep in tests by default; grant TTL is driven deterministically
    // through the injected clock + a read (or handle.sweepGrants()).
    grantSweepMs: 0,
    ...(now ? { now } : {}),
    ...rest,
  });
  registerBoardstateRpc(host, {
    store,
    dataRead: { stateDir },
    ...nodeRpcDeps(),
    capabilityToolsHash: handle.capabilityToolsHash,
    ...(now ? { now } : {}),
  });
  actionEvents = [];
  host.addEventListener("dashboard.action.changed", (payload) => {
    actionEvents.push(payload as { id: string; status: string; autoConfirmed?: boolean });
  });
  await handle.ready;
}

/** Approve a connector's full requested grant through the operator RPC. */
async function grantAll(name: string): Promise<void> {
  await host.request("dashboard.capability.approve", { name, decision: "granted", actor: "user" });
}

/** Approve with an explicit tools subset + optional autoConfirm/TTL/agents (SPEC §17.1/§17.2/§17 TTLs/§17.3). */
async function grant(
  name: string,
  opts: { tools?: string[]; autoConfirm?: string[]; expiresAt?: string; agents?: string[] } = {},
): Promise<{ ok: boolean; code?: string }> {
  return req("dashboard.capability.approve", {
    name,
    decision: "granted",
    actor: "user",
    ...opts,
  });
}

/**
 * Invoke a method with a SERVER-BOUND agent identity (SPEC §17.3): the `agentId` is threaded
 * through the request context (as an in-process session / the agent-tool adapter does), NEVER
 * a param — so this exercises the authentic-actor path, not a client claim.
 */
async function reqAs(
  agentId: string | undefined,
  method: string,
  params?: unknown,
): Promise<{ ok: boolean; result?: any; code?: string }> {
  try {
    return {
      ok: true,
      result: await host.request(method, params, agentId ? { agentId } : undefined),
    };
  } catch (error) {
    return { ok: false, code: (error as { code?: string }).code };
  }
}

async function req(
  method: string,
  params?: unknown,
): Promise<{ ok: boolean; result?: any; code?: string }> {
  try {
    return { ok: true, result: await host.request(method, params) };
  } catch (error) {
    return { ok: false, code: (error as { code?: string }).code };
  }
}

const READ = {
  id: "officecli:read_mail",
  connector: "officecli",
  tool: "read_mail",
  readOnly: true,
};
const SEND = {
  id: "officecli:send_mail",
  connector: "officecli",
  tool: "send_mail",
  readOnly: false,
};
const BOOM = { id: "officecli:boom", connector: "officecli", tool: "boom", readOnly: false };

afterEach(async () => {
  handle?.stop();
  handle = null;
  vi.useRealTimers();
  if (stateDir) {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

describe("grant registration (mirrors installConnector)", () => {
  it("lands a tools-only `requested` grant with explicit empty methods/streams + a hash", async () => {
    await setup([READ, SEND]);
    const grant = (await store.read()).capabilitiesRegistry!.officecli!;
    expect(grant.status).toBe("requested");
    expect(grant.methods).toEqual([]);
    expect(grant.streams).toEqual([]);
    expect(grant.tools).toEqual(["officecli:read_mail", "officecli:send_mail"]);
    expect(typeof grant.toolsHash).toBe("string");
  });

  it("leaves an already-granted grant alone across a refresh (approval survives restart)", async () => {
    await setup([READ, SEND]);
    await grantAll("officecli");
    await handle!.refreshGrants();
    expect((await store.read()).capabilitiesRegistry!.officecli!.status).toBe("granted");
  });
});

describe("dashboard.action.invoke — AND-gate + direct readOnly execution", () => {
  it("refuses an ungranted tool with capability_pending (never calls the broker)", async () => {
    await setup([READ, SEND]);
    const res = await req("dashboard.action.invoke", { connector: "officecli", tool: "read_mail" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("capability_pending");
    expect(broker.calls).toHaveLength(0);
  });

  it("refuses an unconfigured connector as inert (SPEC §18 config authorship)", async () => {
    await setup([READ]);
    const res = await req("dashboard.action.invoke", { connector: "ghost", tool: "x" });
    expect(res.code).toBe("unknown_connector");
  });

  it("executes a granted readOnly tool directly and returns the result", async () => {
    await setup([READ, SEND]);
    await grantAll("officecli");
    const res = await req("dashboard.action.invoke", { connector: "officecli", tool: "read_mail" });
    expect(res.ok).toBe(true);
    expect(res.result.content).toBeDefined();
    expect(broker.calls).toEqual([{ id: "officecli:read_mail", args: {} }]);
  });
});

describe("dashboard.connector.read — the pure-read verb (mcp bindings)", () => {
  it("executes a granted readOnly tool and returns its value", async () => {
    await setup([READ, SEND]);
    await grantAll("officecli");
    const res = await req("dashboard.connector.read", {
      connector: "officecli",
      tool: "read_mail",
    });
    expect(res.ok).toBe(true);
    expect(res.result.content).toBeDefined();
    expect(broker.calls).toEqual([{ id: "officecli:read_mail", args: {} }]);
  });

  it("refuses a mutation tool WITHOUT parking a pending action (a read has no side effect)", async () => {
    // Adversarial verify 2026-07-10: a read binding routed through action.invoke would
    // PARK a pending mutation on every refresh — queue spam, and an operator confirm
    // would fire it. connector.read must refuse without touching the queue.
    await setup([READ, SEND]);
    await grantAll("officecli");
    const res = await req("dashboard.connector.read", {
      connector: "officecli",
      tool: "send_mail",
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("not_readonly");
    expect(broker.calls).toHaveLength(0); // never executed
    expect(handle!.pendingActions()).toHaveLength(0); // and never parked
    expect(actionEvents).toHaveLength(0); // no dashboard.action.changed emitted
  });

  it("refuses an ungranted tool (never calls the broker, never parks)", async () => {
    await setup([READ, SEND]);
    const res = await req("dashboard.connector.read", {
      connector: "officecli",
      tool: "read_mail",
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("capability_pending");
    expect(broker.calls).toHaveLength(0);
    expect(handle!.pendingActions()).toHaveLength(0);
  });
});

describe("dashboard.action.invoke — mutations park behind confirm", () => {
  it("parks a non-readOnly call, never executing until an operator confirms once", async () => {
    await setup([READ, SEND]);
    await grantAll("officecli");
    const parked = await req("dashboard.action.invoke", {
      connector: "officecli",
      tool: "send_mail",
      args: { to: "ops@x.io" },
    });
    expect(parked.result).toMatchObject({ pending: true });
    expect(parked.result.id).toMatch(/^act_/);
    expect(broker.calls).toHaveLength(0); // parked ≠ executed
    expect(handle!.pendingActions()).toHaveLength(1);

    const confirmed = await req("dashboard.action.confirm", {
      id: parked.result.id,
      actor: "user",
    });
    expect(confirmed.ok).toBe(true);
    expect(broker.calls).toEqual([{ id: "officecli:send_mail", args: { to: "ops@x.io" } }]);
    expect(handle!.pendingActions()).toHaveLength(0);

    // Replay of the now-terminal id errors — single-shot.
    const replay = await req("dashboard.action.confirm", { id: parked.result.id });
    expect(replay.code).toBe("action_not_pending");
  });

  it("deny is terminal and never executes; replay errors", async () => {
    await setup([READ, SEND]);
    await grantAll("officecli");
    const parked = await req("dashboard.action.invoke", {
      connector: "officecli",
      tool: "send_mail",
    });
    const denied = await req("dashboard.action.deny", { id: parked.result.id, actor: "user" });
    expect(denied.ok).toBe(true);
    expect(broker.calls).toHaveLength(0);
    expect((await req("dashboard.action.deny", { id: parked.result.id })).code).toBe(
      "action_not_pending",
    );
  });

  it("a confirmed action whose execution fails is still single-shot (never re-runnable)", async () => {
    await setup([READ, BOOM]);
    await grantAll("officecli");
    const parked = await req("dashboard.action.invoke", { connector: "officecli", tool: "boom" });
    const confirmed = await req("dashboard.action.confirm", { id: parked.result.id });
    expect(confirmed.ok).toBe(false); // execution error surfaced
    expect(broker.calls).toHaveLength(1);
    expect((await req("dashboard.action.confirm", { id: parked.result.id })).code).toBe(
      "action_not_pending",
    );
  });

  it("two concurrent confirms of one action execute the mutation exactly once", async () => {
    // Adversarial verify 2026-07-10: `requirePending` only READ the entry, so two
    // confirms racing across the broker await both passed the pending check and
    // double-executed. The action is claimed synchronously before the await now.
    await setup([READ, SEND]);
    await grantAll("officecli");
    const parked = await req("dashboard.action.invoke", {
      connector: "officecli",
      tool: "send_mail",
      args: { to: "ops@x.io" },
    });
    const [a, b] = await Promise.all([
      req("dashboard.action.confirm", { id: parked.result.id }),
      req("dashboard.action.confirm", { id: parked.result.id }),
    ]);
    expect(broker.calls).toHaveLength(1); // the mutation fired once, not twice
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1); // exactly one confirm won
    const loser = a.ok ? b : a;
    expect(loser.code).toBe("action_not_pending");
  });

  it("a confirm in flight cannot be overturned by a concurrent deny", async () => {
    // Same claim guards confirm-vs-deny: the sync claim removes the entry before the
    // broker await yields, so a racing deny gets action_not_pending and can never
    // overwrite the executed action's terminal status.
    await setup([READ, SEND]);
    await grantAll("officecli");
    const parked = await req("dashboard.action.invoke", {
      connector: "officecli",
      tool: "send_mail",
      args: { to: "ops@x.io" },
    });
    const [confirmed, denied] = await Promise.all([
      req("dashboard.action.confirm", { id: parked.result.id }),
      req("dashboard.action.deny", { id: parked.result.id }),
    ]);
    expect(confirmed.ok).toBe(true); // confirm claimed first (dispatched first)
    expect(broker.calls).toHaveLength(1); // executed exactly once
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe("action_not_pending"); // deny found nothing to overturn
    // The audit trail ends on "confirmed"/executed, never a deny-after-execute.
    const last = handle!.auditLog().at(-1);
    expect(last).toMatchObject({ event: "confirm", outcome: "executed" });
  });
});

describe("TTL expiry", () => {
  beforeEach(() => vi.useFakeTimers());

  it("expires a parked action past its TTL; a later confirm errors and nothing executes", async () => {
    await setup([SEND], { ttlMs: 1000 });
    await grantAll("officecli");
    const parked = await req("dashboard.action.invoke", {
      connector: "officecli",
      tool: "send_mail",
    });
    expect(handle!.pendingActions()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1001);
    expect(handle!.pendingActions()).toHaveLength(0);
    expect((await req("dashboard.action.confirm", { id: parked.result.id })).code).toBe(
      "action_not_pending",
    );
    expect(broker.calls).toHaveLength(0);
    expect(actionEvents.some((event) => event.status === "expired")).toBe(true);
  });

  it("the TTL timer cannot fire while a confirm is executing (real interleave)", async () => {
    // The genuine confirm-vs-TTL race: the timer must not settle the action to
    // `expired` WHILE confirm is suspended mid-broker-call. The claim clears the
    // timer synchronously before the await, so advancing past the TTL during the
    // suspended call is a no-op. Pre-fix, the timer fired here and overwrote the
    // in-flight confirm with an `expired` terminal + audit entry.
    await setup([READ, SEND], { ttlMs: 1000 });
    await grantAll("officecli");
    const parked = await req("dashboard.action.invoke", {
      connector: "officecli",
      tool: "send_mail",
    });
    const release = broker.pauseNextCall(); // suspend the tool call mid-confirm
    const confirming = req("dashboard.action.confirm", { id: parked.result.id });
    await vi.advanceTimersByTimeAsync(2000); // TTL elapses WHILE the call is suspended
    expect(actionEvents.some((event) => event.status === "expired")).toBe(false);
    release();
    const confirmed = await confirming;
    expect(confirmed.ok).toBe(true);
    expect(broker.calls).toHaveLength(1);
    expect(handle!.auditLog().filter((entry) => entry.event === "expire")).toHaveLength(0);
    expect(handle!.auditLog().at(-1)).toMatchObject({ event: "confirm", outcome: "executed" });
  });
});

describe("rate limiting (prompt-gate discipline, server-side)", () => {
  it("refuses invokes past the per-connector window", async () => {
    await setup([READ], { invokeRateMax: 2 });
    await grantAll("officecli");
    expect(
      (await req("dashboard.action.invoke", { connector: "officecli", tool: "read_mail" })).ok,
    ).toBe(true);
    expect(
      (await req("dashboard.action.invoke", { connector: "officecli", tool: "read_mail" })).ok,
    ).toBe(true);
    const third = await req("dashboard.action.invoke", {
      connector: "officecli",
      tool: "read_mail",
    });
    expect(third.code).toBe("rate_limited");
  });
});

describe("anti-rug-pull (SPEC §17.1) at invoke time", () => {
  it("re-pends the grant and refuses when a granted tool's manifest hash moves", async () => {
    await setup([READ, SEND]);
    await grantAll("officecli");
    // A granted tool's schema/readOnly changes under the live grant.
    broker.mutateTool("officecli:read_mail");
    const res = await req("dashboard.action.invoke", { connector: "officecli", tool: "read_mail" });
    expect(res.code).toBe("capability_pending");
    expect(broker.calls).toHaveLength(0);
    // The grant was forced back to `requested` before any call succeeded.
    expect((await store.read()).capabilitiesRegistry!.officecli!.status).toBe("requested");
  });
});

describe("audit + confirmAndExecute (M5c-1 blocking primitive)", () => {
  it("records an audit entry per invoke and decision", async () => {
    await setup([READ, SEND]);
    await grantAll("officecli");
    await req("dashboard.action.invoke", { connector: "officecli", tool: "read_mail" });
    const parked = await req("dashboard.action.invoke", {
      connector: "officecli",
      tool: "send_mail",
    });
    await req("dashboard.action.confirm", { id: parked.result.id, actor: "user" });
    const log = handle!.auditLog();
    expect(log.map((entry) => [entry.event, entry.outcome])).toEqual([
      ["invoke", "executed"],
      ["invoke", "pending"],
      ["confirm", "executed"],
    ]);
  });

  it("confirmAndExecute resolves with the result on confirm and rejects on deny", async () => {
    await setup([SEND]);
    await grantAll("officecli");
    const parked = await req("dashboard.action.invoke", {
      connector: "officecli",
      tool: "send_mail",
    });
    const waiting = handle!.confirmAndExecute(parked.result.id);
    await host.request("dashboard.action.confirm", { id: parked.result.id, actor: "user" });
    await expect(waiting).resolves.toMatchObject({ content: expect.anything() });

    const parked2 = await req("dashboard.action.invoke", {
      connector: "officecli",
      tool: "send_mail",
    });
    const waiting2 = handle!.confirmAndExecute(parked2.result.id);
    await host.request("dashboard.action.deny", { id: parked2.result.id, actor: "user" });
    await expect(waiting2).rejects.toThrow(/denied/);
  });
});

describe("per-tool auto-confirm (SPEC §17.2, #62)", () => {
  it("executes an autoConfirm mutation DIRECTLY, audited auto-confirmed, without parking", async () => {
    await setup([READ, SEND]);
    await grant("officecli", { autoConfirm: ["officecli:send_mail"] });
    const res = await req("dashboard.action.invoke", { connector: "officecli", tool: "send_mail" });
    expect(res.ok).toBe(true);
    // A direct execution returns the tool result inline — never a { pending } envelope.
    expect(res.result.pending).toBeUndefined();
    expect(res.result.content).toBeDefined();
    expect(broker.calls).toEqual([{ id: "officecli:send_mail", args: {} }]);
    expect(handle!.pendingActions()).toHaveLength(0);
    const last = handle!.auditLog().at(-1)!;
    expect(last.outcome).toBe("auto-confirmed");
    // The board timeline sees a confirmed status flagged autoConfirmed (honest bypass).
    const evt = actionEvents.at(-1)!;
    expect(evt.status).toBe("confirmed");
    expect(evt.autoConfirmed).toBe(true);
  });

  it("still PARKS a second (non-autoConfirm) mutation of the same connector", async () => {
    await setup([SEND, BOOM]);
    await grant("officecli", { autoConfirm: ["officecli:send_mail"] });
    const auto = await req("dashboard.action.invoke", {
      connector: "officecli",
      tool: "send_mail",
    });
    expect(auto.result.pending).toBeUndefined();
    const parked = await req("dashboard.action.invoke", { connector: "officecli", tool: "boom" });
    expect(parked.result.pending).toBe(true);
    expect(handle!.pendingActions().map((a) => a.tool)).toEqual(["boom"]);
  });

  it("still rate-limits an autoConfirm tool (bypasses confirm, not the prompt gate)", async () => {
    await setup([SEND], { invokeRateMax: 2 });
    await grant("officecli", { autoConfirm: ["officecli:send_mail"] });
    await req("dashboard.action.invoke", { connector: "officecli", tool: "send_mail" });
    await req("dashboard.action.invoke", { connector: "officecli", tool: "send_mail" });
    const third = await req("dashboard.action.invoke", {
      connector: "officecli",
      tool: "send_mail",
    });
    expect(third.ok).toBe(false);
    expect(third.code).toBe("rate_limited");
  });

  it("REJECTS an autoConfirm id outside the granted tools", async () => {
    await setup([READ, SEND]);
    const res = await grant("officecli", {
      tools: ["officecli:read_mail"],
      autoConfirm: ["officecli:send_mail"],
    });
    expect(res.ok).toBe(false);
  });

  it("anti-rug-pull re-pend WIPES autoConfirm (a tool that changed must not keep auto-run)", async () => {
    await setup([SEND]);
    await grant("officecli", { autoConfirm: ["officecli:send_mail"] });
    broker.mutateTool("officecli:send_mail");
    const res = await req("dashboard.action.invoke", { connector: "officecli", tool: "send_mail" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("capability_pending");
    const grantAfter = (await store.read()).capabilitiesRegistry!.officecli!;
    expect(grantAfter.status).toBe("requested");
    expect(grantAfter.autoConfirm).toBeUndefined();
  });

  it("revoke clears autoConfirm", async () => {
    await setup([SEND]);
    await grant("officecli", { autoConfirm: ["officecli:send_mail"] });
    await host.request("dashboard.capability.approve", {
      name: "officecli",
      decision: "revoked",
      actor: "user",
    });
    const grantAfter = (await store.read()).capabilitiesRegistry!.officecli!;
    expect(grantAfter.status).toBe("revoked");
    expect(grantAfter.autoConfirm).toBeUndefined();
  });
});

describe("grant TTLs (SPEC §17 grant TTLs, #64)", () => {
  const BASE = Date.parse("2026-07-11T00:00:00.000Z");

  it("a granted tool is callable before expiry, then re-pends after the clock passes", async () => {
    let t = BASE;
    await setup([READ, SEND], { now: () => t });
    const expiresAt = new Date(BASE + 60_000).toISOString();
    expect((await grant("officecli", { expiresAt })).ok).toBe(true);
    // Callable while the lease is live.
    const before = await req("dashboard.action.invoke", {
      connector: "officecli",
      tool: "read_mail",
    });
    expect(before.ok).toBe(true);
    // Advance past expiry: the lazy sweep-on-read re-pends the grant.
    t = BASE + 61_000;
    const after = await req("dashboard.action.invoke", {
      connector: "officecli",
      tool: "read_mail",
    });
    expect(after.ok).toBe(false);
    expect(after.code).toBe("capability_pending");
    const grantAfter = (await store.read()).capabilitiesRegistry!.officecli!;
    expect(grantAfter.status).toBe("requested");
    expect(grantAfter.expiresAt).toBeUndefined();
  });

  it("expiry clears autoConfirm too (a lapsed lease keeps no auto-run)", async () => {
    let t = BASE;
    await setup([SEND], { now: () => t });
    await grant("officecli", {
      autoConfirm: ["officecli:send_mail"],
      expiresAt: new Date(BASE + 60_000).toISOString(),
    });
    t = BASE + 61_000;
    const grantAfter = (await store.read()).capabilitiesRegistry!.officecli!;
    expect(grantAfter.status).toBe("requested");
    expect(grantAfter.autoConfirm).toBeUndefined();
  });

  it("renew = re-approve restores a callable grant with a fresh TTL", async () => {
    let t = BASE;
    await setup([READ], { now: () => t });
    await grant("officecli", { expiresAt: new Date(BASE + 60_000).toISOString() });
    t = BASE + 61_000;
    await store.read(); // trigger the sweep → requested
    expect((await store.read()).capabilitiesRegistry!.officecli!.status).toBe("requested");
    // Renew with a fresh future TTL.
    const renewed = await grant("officecli", { expiresAt: new Date(t + 60_000).toISOString() });
    expect(renewed.ok).toBe(true);
    const res = await req("dashboard.action.invoke", { connector: "officecli", tool: "read_mail" });
    expect(res.ok).toBe(true);
  });

  it("REJECTS a past-dated TTL at approve (must be future-dated)", async () => {
    const t = BASE;
    await setup([READ], { now: () => t });
    const res = await grant("officecli", { expiresAt: new Date(BASE - 1000).toISOString() });
    expect(res.ok).toBe(false);
  });

  it("fail-closed: park-then-expire-then-confirm is REFUSED", async () => {
    let t = BASE;
    await setup([SEND], { now: () => t, ttlMs: 10 * 60_000 });
    await grant("officecli", { expiresAt: new Date(BASE + 60_000).toISOString() });
    const parked = await req("dashboard.action.invoke", {
      connector: "officecli",
      tool: "send_mail",
    });
    expect(parked.result.pending).toBe(true);
    // The grant expires between park and confirm.
    t = BASE + 61_000;
    const confirmed = await req("dashboard.action.confirm", {
      id: parked.result.id,
      actor: "user",
    });
    expect(confirmed.ok).toBe(false);
    // The mutation NEVER ran (broker saw no call for send_mail).
    expect(broker.calls.filter((c) => c.id === "officecli:send_mail")).toHaveLength(0);
  });
});

describe("async settlement hook (SPEC §18 async settlement, #63)", () => {
  it("fires onActionSettled on confirm with the tool result", async () => {
    const settled: Array<{ record: PendingActionRecord; result: ActionSettlementResult }> = [];
    await setup([SEND], { onActionSettled: (record, result) => settled.push({ record, result }) });
    await grantAll("officecli");
    const parked = await req("dashboard.action.invoke", {
      connector: "officecli",
      tool: "send_mail",
    });
    await host.request("dashboard.action.confirm", { id: parked.result.id, actor: "user" });
    expect(settled).toHaveLength(1);
    expect(settled[0]!.record.status).toBe("confirmed");
    expect(settled[0]!.result).toMatchObject({ ok: true });
  });

  it("fires onActionSettled on deny with a refusal reason", async () => {
    const settled: Array<{ record: PendingActionRecord; result: ActionSettlementResult }> = [];
    await setup([SEND], { onActionSettled: (record, result) => settled.push({ record, result }) });
    await grantAll("officecli");
    const parked = await req("dashboard.action.invoke", {
      connector: "officecli",
      tool: "send_mail",
    });
    await host.request("dashboard.action.deny", { id: parked.result.id, actor: "user" });
    expect(settled).toHaveLength(1);
    expect(settled[0]!.result).toEqual({ ok: false, reason: "denied" });
  });

  it("a direct (auto-confirmed) execution NEVER fires the settlement hook (it never parked)", async () => {
    const settled: unknown[] = [];
    await setup([SEND], { onActionSettled: (record, result) => settled.push({ record, result }) });
    await grant("officecli", { autoConfirm: ["officecli:send_mail"] });
    await req("dashboard.action.invoke", { connector: "officecli", tool: "send_mail" });
    expect(settled).toHaveLength(0);
  });
});

describe("per-agent grant scoping (SPEC §17.3, #59) — the actor dimension of the AND-gate", () => {
  it("a scoped grant passes for a listed agent and refuses another (capability_pending)", async () => {
    await setup([READ, SEND]);
    await grant("officecli", { agents: ["agent:alice"] });
    // Alice is in scope: her readOnly call executes.
    const forAlice = await reqAs("alice", "dashboard.action.invoke", {
      connector: "officecli",
      tool: "read_mail",
    });
    expect(forAlice.ok).toBe(true);
    // Bob is out of scope: refused, and the broker is never called on his behalf.
    const beforeBob = broker.calls.length;
    const forBob = await reqAs("bob", "dashboard.action.invoke", {
      connector: "officecli",
      tool: "read_mail",
    });
    expect(forBob.ok).toBe(false);
    expect(forBob.code).toBe("capability_pending");
    expect(broker.calls.length).toBe(beforeBob);
  });

  it("an unscoped grant (no agents) is usable by every agent — back-compat, byte-identical", async () => {
    await setup([READ, SEND]);
    await grantAll("officecli");
    expect(
      (
        await reqAs("alice", "dashboard.action.invoke", {
          connector: "officecli",
          tool: "read_mail",
        })
      ).ok,
    ).toBe(true);
    expect(
      (await reqAs("bob", "dashboard.action.invoke", { connector: "officecli", tool: "read_mail" }))
        .ok,
    ).toBe(true);
    // And with NO bound identity at all (today's default path).
    expect(
      (await req("dashboard.action.invoke", { connector: "officecli", tool: "read_mail" })).ok,
    ).toBe(true);
  });

  it("a scoped grant fails closed for an UNAUTHENTICATED caller (no server-bound identity)", async () => {
    await setup([READ, SEND]);
    await grant("officecli", { agents: ["agent:alice"] });
    // No ctx.agentId — a raw networked caller. It can never satisfy a scoped grant.
    const res = await req("dashboard.action.invoke", { connector: "officecli", tool: "read_mail" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("capability_pending");
  });

  it("actor authenticity: a param cannot claim another agent's scope (params reject `actor`)", async () => {
    await setup([READ, SEND]);
    await grant("officecli", { agents: ["agent:alice"] });
    // Bob tries to smuggle Alice's identity via a param — invoke rejects the extra key AND
    // the scope check keys off the (absent) server-bound identity, never the claim.
    const res = await reqAs("bob", "dashboard.action.invoke", {
      connector: "officecli",
      tool: "read_mail",
      actor: "agent:alice",
    });
    expect(res.ok).toBe(false);
    // The param is rejected before the gate is even consulted.
    expect(res.code).toBe("bad_request");
  });

  it("connector.read enforces scope too (a read binding is fail-safe rechecked)", async () => {
    await setup([READ, SEND]);
    await grant("officecli", { agents: ["agent:alice"] });
    expect(
      (
        await reqAs("alice", "dashboard.connector.read", {
          connector: "officecli",
          tool: "read_mail",
        })
      ).ok,
    ).toBe(true);
    const bob = await reqAs("bob", "dashboard.connector.read", {
      connector: "officecli",
      tool: "read_mail",
    });
    expect(bob.ok).toBe(false);
    expect(bob.code).toBe("capability_pending");
  });

  it("a scoped mutation parks under the requesting agent and confirms against IT, not the operator", async () => {
    await setup([SEND]);
    await grant("officecli", { agents: ["agent:alice"] });
    const parked = await reqAs("alice", "dashboard.action.invoke", {
      connector: "officecli",
      tool: "send_mail",
    });
    expect(parked.ok).toBe(true);
    const rec = handle!.pendingActions().find((entry) => entry.id === parked.result.id);
    expect(rec?.requestedBy).toBe("agent:alice"); // server-bound provenance
    // The operator confirms; the re-gate checks Alice's scope (still valid), not "user".
    const confirmed = await host.request("dashboard.action.confirm", {
      id: parked.result.id,
      actor: "user",
    });
    expect(confirmed).toMatchObject({ id: parked.result.id });
  });

  it("re-scoping to exclude the requester between park and confirm REFUSES at confirm (fail-closed)", async () => {
    await setup([SEND]);
    await grant("officecli", { agents: ["agent:alice"] });
    const parked = await reqAs("alice", "dashboard.action.invoke", {
      connector: "officecli",
      tool: "send_mail",
    });
    // Operator re-scopes the grant to exclude Alice while her action is parked.
    await grant("officecli", { agents: ["agent:bob"] });
    const confirm = await req("dashboard.action.confirm", { id: parked.result.id, actor: "user" });
    expect(confirm.ok).toBe(false);
    expect(broker.calls).toHaveLength(0); // never executed
  });

  it("scope is WIPED on a manifest-drift re-pend (operator re-scopes on re-approval)", async () => {
    await setup([READ, SEND]);
    await grant("officecli", { agents: ["agent:alice"] });
    broker.mutateTool("officecli:read_mail"); // rug-pull: subset hash moves
    const res = await reqAs("alice", "dashboard.action.invoke", {
      connector: "officecli",
      tool: "read_mail",
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("capability_pending");
    const grantAfter = (await store.read()).capabilitiesRegistry!.officecli!;
    expect(grantAfter.status).toBe("requested");
    expect(grantAfter.agents).toBeUndefined();
  });

  it("revoke clears the per-agent scope", async () => {
    await setup([READ]);
    await grant("officecli", { agents: ["agent:alice"] });
    await req("dashboard.capability.approve", {
      name: "officecli",
      decision: "revoked",
      actor: "user",
    });
    expect((await store.read()).capabilitiesRegistry!.officecli!.agents).toBeUndefined();
  });
});

describe("per-agent rate budget (SPEC §17.3, #59) — rate = min(connector, per-agent)", () => {
  it("caps each agent independently and preserves the connector ceiling", async () => {
    // Connector ceiling 10 (default), per-agent ceiling 2.
    await setup([READ], { perAgentInvokeRateMax: 2 });
    await grantAll("officecli");
    const call = (agent: string) =>
      reqAs(agent, "dashboard.action.invoke", { connector: "officecli", tool: "read_mail" });
    expect((await call("alice")).ok).toBe(true);
    expect((await call("alice")).ok).toBe(true);
    const third = await call("alice"); // trips Alice's per-agent budget
    expect(third.ok).toBe(false);
    expect(third.code).toBe("rate_limited");
    // Bob has his OWN budget — unaffected by Alice's.
    expect((await call("bob")).ok).toBe(true);
  });

  it("with no per-agent budget set, only the connector window applies (byte-identical)", async () => {
    await setup([READ]); // perAgentInvokeRateMax unset
    await grantAll("officecli");
    // Well under the connector ceiling of 10, same agent, all pass.
    for (let i = 0; i < 5; i++) {
      expect(
        (
          await reqAs("alice", "dashboard.action.invoke", {
            connector: "officecli",
            tool: "read_mail",
          })
        ).ok,
      ).toBe(true);
    }
  });
});
