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
  type ActionToolManifest,
  type ActionToolManifestEntry,
  type BrokerActionsHandle,
} from "./broker-actions.js";

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
let actionEvents: Array<{ id: string; status: string }>;

async function setup(
  entries: ActionToolManifestEntry[],
  opts: { ttlMs?: number; invokeRateMax?: number } = {},
): Promise<void> {
  stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "boardstate-actions-"));
  const storage = new FsStorageAdapter({ storageDir: stateDir });
  store = new DashboardStore({ storage });
  host = createInProcessHost(store, storage);
  broker = new FakeBroker(entries);
  handle = installBrokerActions(host, { broker, store, ...opts });
  registerBoardstateRpc(host, {
    store,
    dataRead: { stateDir },
    ...nodeRpcDeps(),
    capabilityToolsHash: handle.capabilityToolsHash,
  });
  actionEvents = [];
  host.addEventListener("dashboard.action.changed", (payload) => {
    actionEvents.push(payload as { id: string; status: string });
  });
  await handle.ready;
}

/** Approve a connector's full requested grant through the operator RPC. */
async function grantAll(name: string): Promise<void> {
  await host.request("dashboard.capability.approve", { name, decision: "granted", actor: "user" });
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
