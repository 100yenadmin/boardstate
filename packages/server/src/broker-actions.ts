// The M5 trust layer's server-enforced half (SPEC §17.1 tool grants + §18 pending
// actions): grant registration for external MCP tools, and the pending-action engine
// that makes epic invariant #5 ENFORCEABLE rather than a browser-side UI promise.
//
// It consumes a broker (the `@boardstate/broker` MCP client manager) through a NARROW
// STRUCTURAL interface ({@link ActionBroker}) — NOT an import — exactly as
// `installConnector` takes a structural host + store. This keeps the dependency arrow
// one-way (broker → server) with no cycle: `@boardstate/broker` never has to enter
// `@boardstate/server`, and the real `McpBroker` satisfies {@link ActionBroker}
// structurally. It is node-side glue; browser bundles never load it.
//
// Two surfaces, one operator spine:
//  • Grant registration — mirrors `installConnector`'s request-on-install: each
//    configured connector's discovered tools land as a `requested` tools-only grant
//    (`methods: [], streams: []`, explicit `tools` + subset `toolsHash` snapshot). A
//    connector already `granted` is left alone (a restart never revokes an operator's
//    approval; invoke-time anti-rug-pull covers real manifest drift).
//  • The pending-action engine — `dashboard.action.invoke` AND-gates a call (tool
//    granted at invoke time + connector configured + manifest hash unchanged); a
//    `readOnly` granted tool executes directly, a mutation is parked as a pending
//    action requiring an OPERATOR `dashboard.action.confirm` (operator-only, §18).

import type { DashboardActor, JsonValue, PendingActionRecord } from "@boardstate/schema";
import { validatePendingAction } from "@boardstate/schema";
import type { DashboardStore } from "@boardstate/core";
import type { ServerHost } from "./host.js";

const CONNECTOR_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const CONNECTOR_TOOL_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
// Args objects match the schema's binding envelope cap (8 KB) — the same bound a
// static/mcp binding gets, so a parked action can never balloon the workspace or a
// call payload.
const MAX_ARGS_BYTES = 8 * 1024;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_RATE_MAX = 10;
const DEFAULT_RATE_WINDOW_MS = 60_000;

/** Protocol broadcast for pending-action lifecycle transitions (SPEC §18). */
export const ACTION_EVENT = "dashboard.action.changed";

const randomId = (): string => `act_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;

/** A discovered tool the broker advertises (the fields the engine reads). */
export type ActionToolManifestEntry = {
  /** Namespaced `connector:tool` id. */
  id: string;
  connector: string;
  tool: string;
  /** Absent/false ⇒ treated as a mutation (fail-safe), matching the broker/manifest. */
  readOnly?: boolean;
};

/** The broker's tool snapshot (structurally a `ToolManifest`). */
export type ActionToolManifest = {
  tools: ActionToolManifestEntry[];
  /** Stable hash over the whole manifest (unused here; subset hashes drive grants). */
  hash: string;
};

/**
 * The narrow broker surface the engine needs. `McpBroker` satisfies it structurally —
 * the engine never imports `@boardstate/broker`, so the dependency arrow stays
 * one-way. `hashToolSubset` returns the anti-rug-pull digest scoped to EXACTLY the
 * grant's tool-id set, so the hash moves iff one of the GRANTED tools' schema/readOnly
 * changes (adding an unrelated tool to the connector never re-pends a partial grant).
 */
export interface ActionBroker {
  connectorNames(): string[];
  listTools(): Promise<ActionToolManifest>;
  callTool(
    toolRef: string,
    args?: Record<string, unknown>,
    opts?: { timeout?: number },
  ): Promise<{ content: unknown; structuredContent?: unknown }>;
  hashToolSubset(manifest: ActionToolManifest, toolIds: readonly string[]): string;
}

/** One audit-log entry: who did what, when, to which tool, with what outcome. */
export type BrokerActionAuditEntry = {
  at: string;
  event: "invoke" | "confirm" | "deny" | "expire";
  id: string;
  connector: string;
  tool: string;
  actor?: string;
  outcome: "executed" | "pending" | "denied" | "expired" | "error";
  error?: string;
};

export type InstallBrokerActionsOptions = {
  broker: ActionBroker;
  store: DashboardStore;
  /** Clock (ms). Injectable for deterministic TTL tests. Default `Date.now`. */
  now?: () => number;
  /** Pending-action time-to-live (ms). Default 5 minutes (SPEC §18). */
  ttlMs?: number;
  /** Max `invoke`s per rolling window, per connector (prompt-gate discipline). Default 10. */
  invokeRateMax?: number;
  /** Rolling rate window (ms). Default 60 000. */
  invokeRateWindowMs?: number;
};

export type BrokerActionsHandle = {
  /** Resolves once the initial grant registration has landed (determinism for tests/wiring). */
  ready: Promise<void>;
  /** Re-discover tools and refresh `requested` grants (leaves `granted` grants alone). */
  refreshGrants(): Promise<void>;
  /**
   * Await an operator's decision on a parked action and resolve with the tool result
   * (SPEC §18 / M5c-1: agent-mediated calls block on confirm). Resolves on confirm,
   * rejects on deny / expiry / execution error, or on the optional `timeoutMs` — the
   * agent's wait timing out never changes the action's own lifecycle.
   */
  confirmAndExecute(
    id: string,
    opts?: { timeoutMs?: number },
  ): Promise<{ content: unknown; structuredContent?: unknown }>;
  /** The non-terminal pending actions currently parked. */
  pendingActions(): PendingActionRecord[];
  /** The append-only audit log (newest last). */
  auditLog(): readonly BrokerActionAuditEntry[];
  /**
   * Subset-scoped anti-rug-pull hash for `dashboard.capability.approve`'s partial-grant
   * path (injected as `capabilityToolsHash`). Returns undefined until the first
   * manifest is cached, in which case approve carries the existing hash forward.
   */
  capabilityToolsHash(connector: string, toolIds: readonly string[]): string | undefined;
  /** Clear every TTL timer (idempotent). */
  stop(): void;
};

type Waiter = {
  resolve: (result: { content: unknown; structuredContent?: unknown }) => void;
  reject: (error: unknown) => void;
};

type PendingEntry = {
  record: PendingActionRecord;
  timer: ReturnType<typeof setTimeout>;
  waiters: Waiter[];
};

/** A typed engine error carrying a wire `code` (respondError maps it through). */
class ActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ActionError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read + shape-check `{ connector, tool, args? }` invoke params (fail-closed). */
function readInvokeParams(params: unknown): {
  connector: string;
  tool: string;
  args: Record<string, JsonValue>;
} {
  if (!isRecord(params)) {
    throw new ActionError("bad_request", "params must be an object");
  }
  for (const key of Object.keys(params)) {
    if (!["connector", "tool", "args"].includes(key)) {
      throw new ActionError("bad_request", `unexpected param: ${key}`);
    }
  }
  const connector = params.connector;
  if (typeof connector !== "string" || !CONNECTOR_NAME_PATTERN.test(connector)) {
    throw new ActionError("bad_request", "connector is invalid");
  }
  const tool = params.tool;
  if (typeof tool !== "string" || !CONNECTOR_TOOL_PATTERN.test(tool)) {
    throw new ActionError("bad_request", "tool is invalid");
  }
  const rawArgs = params.args ?? {};
  if (!isRecord(rawArgs)) {
    throw new ActionError("bad_request", "args must be an object");
  }
  if (new TextEncoder().encode(JSON.stringify(rawArgs)).length > MAX_ARGS_BYTES) {
    throw new ActionError("args_too_large", "args exceeds 8 KB");
  }
  return { connector, tool, args: rawArgs as Record<string, JsonValue> };
}

/** Read the required `{ id }` of a confirm/deny call. */
function readActionId(params: unknown): string {
  if (!isRecord(params) || typeof params.id !== "string" || !params.id.trim()) {
    throw new ActionError("bad_request", "id is required");
  }
  for (const key of Object.keys(params)) {
    if (key !== "id" && key !== "actor") {
      throw new ActionError("bad_request", `unexpected param: ${key}`);
    }
  }
  return params.id;
}

function readActor(params: unknown): DashboardActor | undefined {
  if (isRecord(params) && typeof params.actor === "string") {
    return params.actor as DashboardActor;
  }
  return undefined;
}

/**
 * Install the tool-grant lifecycle + pending-action engine onto a host. Registers
 * `dashboard.action.invoke` (any client), `dashboard.action.confirm` /
 * `dashboard.action.deny` (operator-only — see `OPERATOR_ONLY_METHODS`), and
 * `dashboard.action.list` (read), and kicks off the initial grant registration.
 */
export function installBrokerActions(
  host: ServerHost,
  options: InstallBrokerActionsOptions,
): BrokerActionsHandle {
  const { broker, store } = options;
  const now = options.now ?? (() => Date.now());
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const rateMax = options.invokeRateMax ?? DEFAULT_RATE_MAX;
  const rateWindowMs = options.invokeRateWindowMs ?? DEFAULT_RATE_WINDOW_MS;

  const pending = new Map<string, PendingEntry>();
  const audit: BrokerActionAuditEntry[] = [];
  const rateWindows = new Map<string, number[]>();
  let cachedManifest: ActionToolManifest | undefined;

  function record(entry: BrokerActionAuditEntry): void {
    audit.push(entry);
    host.broadcast(ACTION_EVENT, {
      id: entry.id,
      status: pending.get(entry.id)?.record.status ?? terminalStatus(entry.event),
      connector: entry.connector,
      tool: entry.tool,
    });
  }

  function terminalStatus(event: BrokerActionAuditEntry["event"]): PendingActionRecord["status"] {
    switch (event) {
      case "confirm":
        return "confirmed";
      case "deny":
        return "denied";
      case "expire":
        return "expired";
      default:
        return "pending";
    }
  }

  function checkRate(connector: string): void {
    const cutoff = now() - rateWindowMs;
    const stamps = (rateWindows.get(connector) ?? []).filter((ts) => ts > cutoff);
    if (stamps.length >= rateMax) {
      rateWindows.set(connector, stamps);
      throw new ActionError("rate_limited", `too many invocations for connector "${connector}"`);
    }
    stamps.push(now());
    rateWindows.set(connector, stamps);
  }

  /** List tools, cache the manifest for the approve-time hash resolver, return it. */
  async function listAndCache(): Promise<ActionToolManifest> {
    const manifest = await broker.listTools();
    cachedManifest = manifest;
    return manifest;
  }

  /** Group a manifest's tool ids by connector, sorted for a stable snapshot. */
  function toolIdsByConnector(manifest: ActionToolManifest): Map<string, string[]> {
    const byConnector = new Map<string, string[]>();
    for (const entry of manifest.tools) {
      const ids = byConnector.get(entry.connector) ?? [];
      ids.push(entry.id);
      byConnector.set(entry.connector, ids);
    }
    for (const ids of byConnector.values()) {
      ids.sort();
    }
    return byConnector;
  }

  async function refreshGrants(): Promise<void> {
    const manifest = await listAndCache();
    const byConnector = toolIdsByConnector(manifest);
    await store.mutate(
      (draft) => {
        const registry = (draft.capabilitiesRegistry ??= {});
        for (const connector of broker.connectorNames()) {
          const toolIds = byConnector.get(connector) ?? [];
          const toolsHash = broker.hashToolSubset(manifest, toolIds);
          const existing = registry[connector];
          // A `granted` grant is never re-requested on refresh — an operator's
          // approval survives a restart; real manifest drift is caught at invoke time.
          if (existing?.status === "granted") {
            continue;
          }
          const sameShape =
            existing &&
            existing.toolsHash === toolsHash &&
            sameStringSet(existing.tools ?? [], toolIds);
          if (!sameShape) {
            registry[connector] = {
              status: "requested",
              methods: [],
              streams: [],
              tools: toolIds,
              toolsHash,
            };
          }
        }
      },
      { actor: "system" },
    );
  }

  /**
   * Resolve the grant + live manifest for a call, enforcing the AND-gate and BOTH
   * anti-rug-pull directions BEFORE any tool runs. Re-pends the grant (in the write
   * lock) and throws `capability_pending` on a manifest-hash mismatch (SPEC §17.1).
   */
  async function gateCall(
    connector: string,
    tool: string,
  ): Promise<{ id: string; readOnly: boolean }> {
    if (!broker.connectorNames().includes(connector)) {
      // Config authorship (SPEC §18): a doc-introduced connector name is inert.
      throw new ActionError("unknown_connector", `connector "${connector}" is not configured`);
    }
    const id = `${connector}:${tool}`;
    const doc = await store.read();
    const grant = doc.capabilitiesRegistry?.[connector];
    if (grant?.status !== "granted" || !(grant.tools ?? []).includes(id)) {
      throw new ActionError(
        "capability_pending",
        `tool "${id}" is not granted — request and approve it first`,
      );
    }
    const manifest = await listAndCache();
    const liveHash = broker.hashToolSubset(manifest, grant.tools ?? []);
    if (liveHash !== grant.toolsHash) {
      // The connector changed a granted tool's shape under a live grant — re-pend
      // before any call succeeds, never a silent widening.
      await store.mutate(
        (draft) => {
          const entry = draft.capabilitiesRegistry?.[connector];
          if (entry && entry.status === "granted") {
            entry.status = "requested";
            delete entry.grantedBy;
            delete entry.grantedAt;
          }
        },
        { actor: "system" },
      );
      throw new ActionError(
        "capability_pending",
        `connector "${connector}" tool manifest changed — grant re-pended for re-approval`,
      );
    }
    const entry = manifest.tools.find((candidate) => candidate.id === id);
    if (!entry) {
      throw new ActionError("unknown_tool", `tool "${id}" is not in the connector manifest`);
    }
    return { id, readOnly: entry.readOnly === true };
  }

  function settle(
    entry: PendingEntry,
    status: PendingActionRecord["status"],
    event: BrokerActionAuditEntry["event"],
    actor: DashboardActor | undefined,
    outcome: BrokerActionAuditEntry["outcome"],
    error?: string,
  ): void {
    clearTimeout(entry.timer);
    entry.record = { ...entry.record, status };
    pending.delete(entry.record.id);
    record({
      at: new Date(now()).toISOString(),
      event,
      id: entry.record.id,
      connector: entry.record.connector,
      tool: entry.record.tool,
      ...(actor ? { actor } : {}),
      outcome,
      ...(error ? { error } : {}),
    });
  }

  function rejectWaiters(entry: PendingEntry, error: unknown): void {
    for (const waiter of entry.waiters) {
      waiter.reject(error);
    }
    entry.waiters = [];
  }

  /**
   * `dashboard.connector.read` — the PURE-READ verb for `source:"mcp"` bindings.
   * Unlike `invoke`, it NEVER parks: a non-readOnly tool is refused outright, so a
   * refreshing read binding can never spawn pending actions (a read must have no
   * side effect — SPEC §18). A readOnly granted tool executes and returns its value.
   */
  async function read(ctx: {
    params: unknown;
    respond: (ok: boolean, result?: unknown, error?: { code: string; message: string }) => void;
  }): Promise<void> {
    try {
      const { connector, tool, args } = readInvokeParams(ctx.params);
      checkRate(connector);
      const { id, readOnly } = await gateCall(connector, tool);
      if (!readOnly) {
        throw new ActionError(
          "not_readonly",
          `tool "${id}" is not readOnly — a read binding cannot target a side-effecting tool`,
        );
      }
      ctx.respond(true, await broker.callTool(id, args));
    } catch (error) {
      respondActionError(ctx.respond, error);
    }
  }

  async function invoke(ctx: {
    params: unknown;
    respond: (ok: boolean, result?: unknown, error?: { code: string; message: string }) => void;
  }): Promise<void> {
    try {
      const { connector, tool, args } = readInvokeParams(ctx.params);
      const requestedBy = readActor(ctx.params);
      checkRate(connector);
      const { id, readOnly } = await gateCall(connector, tool);

      if (readOnly) {
        // A networked client MAY directly execute a granted readOnly tool (SPEC §18).
        const result = await broker.callTool(id, args);
        record({
          at: new Date(now()).toISOString(),
          event: "invoke",
          id,
          connector,
          tool,
          ...(requestedBy ? { actor: requestedBy } : {}),
          outcome: "executed",
        });
        ctx.respond(true, result);
        return;
      }

      // A mutation is parked; only an operator confirm executes it (§18).
      const createdMs = now();
      const actionId = randomId();
      const pendingRecord = validatePendingAction({
        id: actionId,
        connector,
        tool,
        args,
        ...(requestedBy ? { requestedBy } : {}),
        createdAt: new Date(createdMs).toISOString(),
        expiresAt: new Date(createdMs + ttlMs).toISOString(),
        status: "pending",
      });
      const timer = setTimeout(() => {
        const entry = pending.get(actionId);
        if (!entry) {
          return;
        }
        settle(entry, "expired", "expire", undefined, "expired");
        rejectWaiters(entry, new ActionError("action_expired", `action "${actionId}" expired`));
      }, ttlMs);
      // Node's timer keeps the process alive; the engine is a background gate, not a
      // reason to hold the event loop open.
      (timer as { unref?: () => void }).unref?.();
      const entry: PendingEntry = { record: pendingRecord, timer, waiters: [] };
      pending.set(actionId, entry);
      record({
        at: pendingRecord.createdAt,
        event: "invoke",
        id: actionId,
        connector,
        tool,
        ...(requestedBy ? { actor: requestedBy } : {}),
        outcome: "pending",
      });
      ctx.respond(true, { pending: true, id: actionId, expiresAt: pendingRecord.expiresAt });
    } catch (error) {
      respondActionError(ctx.respond, error);
    }
  }

  /** Execute a confirmed action's tool via the broker; single-shot regardless of outcome. */
  async function executeConfirmed(
    entry: PendingEntry,
    actor: DashboardActor | undefined,
  ): Promise<{ content: unknown; structuredContent?: unknown }> {
    const { connector, tool, id: actionId, args } = entry.record;
    const id = `${connector}:${tool}`;
    // CLAIM the action synchronously — before the broker await yields — so a
    // concurrent confirm (two operator tabs, a double-delivered frame) cannot pass
    // `requirePending` again and double-execute the mutation. This synchronous
    // prologue runs to the first await in one microtask; the expiry timer is cleared
    // here so it can never race the in-flight execution. `settle` below re-deletes
    // (a no-op) and stamps the terminal audit outcome exactly once.
    clearTimeout(entry.timer);
    pending.delete(actionId);
    try {
      const result = await broker.callTool(id, args as Record<string, unknown>);
      settle(entry, "confirmed", "confirm", actor, "executed");
      for (const waiter of entry.waiters) {
        waiter.resolve(result);
      }
      entry.waiters = [];
      return result;
    } catch (error) {
      // The action WAS confirmed (single-shot terminal), but execution failed — never
      // re-runnable. Reject the caller + any agent waiter with the broker error.
      settle(entry, "confirmed", "confirm", actor, "error", formatMessage(error));
      rejectWaiters(entry, error);
      void actionId;
      throw error;
    }
  }

  async function confirm(ctx: {
    params: unknown;
    respond: (ok: boolean, result?: unknown, error?: { code: string; message: string }) => void;
  }): Promise<void> {
    try {
      const actionId = readActionId(ctx.params);
      const actor = readActor(ctx.params);
      const entry = requirePending(actionId);
      const result = await executeConfirmed(entry, actor);
      ctx.respond(true, { id: actionId, result });
    } catch (error) {
      respondActionError(ctx.respond, error);
    }
  }

  function deny(ctx: {
    params: unknown;
    respond: (ok: boolean, result?: unknown, error?: { code: string; message: string }) => void;
  }): void {
    try {
      const actionId = readActionId(ctx.params);
      const actor = readActor(ctx.params);
      const entry = requirePending(actionId);
      settle(entry, "denied", "deny", actor, "denied");
      rejectWaiters(entry, new ActionError("action_denied", `action "${actionId}" was denied`));
      ctx.respond(true, { id: actionId, status: "denied" });
    } catch (error) {
      respondActionError(ctx.respond, error);
    }
  }

  /** A pending, non-terminal entry — a replay of a terminal (or unknown) id errors. */
  function requirePending(actionId: string): PendingEntry {
    const entry = pending.get(actionId);
    if (!entry || entry.record.status !== "pending") {
      throw new ActionError(
        "action_not_pending",
        `action "${actionId}" is not pending (unknown, or already confirmed/denied/expired)`,
      );
    }
    return entry;
  }

  host.registerRpc("dashboard.connector.read", (opts) => read(opts), { scope: "read" });
  host.registerRpc("dashboard.action.invoke", (opts) => invoke(opts), { scope: "write" });
  host.registerRpc("dashboard.action.confirm", (opts) => confirm(opts), { scope: "write" });
  host.registerRpc("dashboard.action.deny", (opts) => deny(opts), { scope: "write" });
  host.registerRpc(
    "dashboard.action.list",
    (opts) => {
      opts.respond(true, { pending: [...pending.values()].map((entry) => entry.record) });
    },
    { scope: "read" },
  );

  const ready = refreshGrants();

  return {
    ready,
    refreshGrants,
    async confirmAndExecute(actionId, opts) {
      const entry = pending.get(actionId);
      if (!entry || entry.record.status !== "pending") {
        throw new ActionError(
          "action_not_pending",
          `action "${actionId}" is not pending — cannot await confirm`,
        );
      }
      return await new Promise<{ content: unknown; structuredContent?: unknown }>(
        (resolve, reject) => {
          const waiter: Waiter = { resolve, reject };
          entry.waiters.push(waiter);
          if (opts?.timeoutMs !== undefined) {
            const timeout = setTimeout(() => {
              entry.waiters = entry.waiters.filter((candidate) => candidate !== waiter);
              reject(new ActionError("action_timeout", `awaiting confirm timed out`));
            }, opts.timeoutMs);
            (timeout as { unref?: () => void }).unref?.();
            const wrapResolve = waiter.resolve;
            const wrapReject = waiter.reject;
            waiter.resolve = (value) => {
              clearTimeout(timeout);
              wrapResolve(value);
            };
            waiter.reject = (error) => {
              clearTimeout(timeout);
              wrapReject(error);
            };
          }
        },
      );
    },
    pendingActions() {
      return [...pending.values()].map((entry) => entry.record);
    },
    auditLog() {
      return audit;
    },
    capabilityToolsHash(connector, toolIds) {
      if (!cachedManifest) {
        return undefined;
      }
      void connector;
      return broker.hashToolSubset(cachedManifest, toolIds);
    },
    stop() {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
      }
    },
  };
}

function respondActionError(
  respond: (ok: boolean, result?: unknown, error?: { code: string; message: string }) => void,
  error: unknown,
): void {
  const code = error instanceof ActionError ? error.code : "action_error";
  respond(false, undefined, { code, message: formatMessage(error) });
}

function formatMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : "action failed";
}

/** Order-insensitive equality for two string lists (grant tool-surface comparison). */
function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const set = new Set(a);
  return b.every((entry) => set.has(entry));
}
