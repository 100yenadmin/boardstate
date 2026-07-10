import {
  DEFAULT_DASHBOARD_WORKSPACE,
  migrateWorkspaceDoc,
  validateWorkspaceDoc,
  type JsonValue,
  type WorkspaceDoc,
} from "@boardstate/schema";
import { joinLogical, LOGICAL_SEP } from "./internal/logical-path.js";
import {
  computeWorkspaceDiff,
  summarizeWorkspaceDiff,
  type DashboardHistorySummary,
} from "./history-client.js";
import { normalizeWorkspace } from "./queries.js";
import type { StorageAdapter } from "./adapters/storage.js";

export type DashboardMutationOptions = { actor: string };
export type DashboardMutationResult = { doc: WorkspaceDoc; changed: boolean };

/** A persisted widget-state envelope: the widget's opaque blob plus write metadata. */
export type WidgetStateRecord = { version: number; updatedAt: string; blob: JsonValue };
export type WidgetStateWriteResult = { version: number };

/**
 * Read-only metadata for one undo-ring snapshot (time-travel history). `version`
 * is the snapshot's own `workspaceVersion` (the state it represents), NOT the ring
 * filename (which is that version + 1, the mutation that superseded it). Bodies
 * are never included here — callers fetch a full snapshot via `getHistorySnapshot`.
 *
 * `summary` is a compact rollup of what changed to REACH this version (the diff
 * from the next-older ring snapshot), or undefined when this is the oldest snapshot
 * still in the ring — there is then no predecessor to diff against. It is derived
 * at list time from snapshots the ring already holds, so it costs no extra disk.
 */
export type DashboardHistoryEntry = {
  version: number;
  savedAt: string;
  bytes: number;
  summary?: DashboardHistorySummary;
};

const MAX_WORKSPACE_BYTES = 256 * 1024;
const UNDO_RING_SIZE = 20;
// Hard per-widget state cap, enforced on the SERIALIZED envelope BEFORE any write.
// Separate from (and smaller than) the 256 KB workspace cap so state blobs never
// count against the workspace document.
const MAX_WIDGET_STATE_BYTES = 64 * 1024;
// The widget id is used as a filename segment under `state/`; it must match the
// same charset the workspace schema enforces for widget ids so a caller can never
// smuggle a path separator or traversal into the state directory.
const WIDGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,48}$/;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function serializeWorkspaceDoc(doc: WorkspaceDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/**
 * Enforce the approval invariant (SPEC §8.2) at the store, not the caller: a
 * full-document `replace` can NEVER elevate a custom widget to `approved`. Any
 * incoming registry entry that claims `approved` for a widget that was not
 * ALREADY `approved` in the current document is forced back to `pending` and its
 * `approvedBy`/`approvedAt` are stripped. The only path to `approved` is an
 * explicit `dashboard.widget.approve` (which edits the entry directly, not via
 * replace); undo/history restore prior *store-produced* docs and never pass
 * through here. This makes the gate structural — it holds no matter which caller
 * (agent tool, import, raw RPC, CLI) reaches `replace`, without trusting any of
 * them to sanitize first.
 */
export function reconcileReplaceApproval(
  incoming: WorkspaceDoc,
  current: WorkspaceDoc,
): WorkspaceDoc {
  const currentRegistry = current.widgetsRegistry ?? {};
  const incomingRegistry = incoming.widgetsRegistry ?? {};
  for (const [name, entry] of Object.entries(incomingRegistry)) {
    if (entry.status === "approved" && currentRegistry[name]?.status !== "approved") {
      entry.status = "pending";
      delete entry.approvedBy;
      delete entry.approvedAt;
    }
  }
  // Capability grants (SPEC §17) get the same structural gate: a `replace` can never
  // elevate a grant to `granted` — only `dashboard.capability.approve` can. Any newly
  // `granted` entry that wasn't already granted in `current` is forced back to
  // `requested`, so a self-grant smuggled through replace/import cannot mount data.
  //
  // Anti-rug-pull, agent-side (SPEC §17.1, both directions): a grant that STAYS
  // `granted` may not have its authorized `tools`/`toolsHash` MUTATED through
  // replace/import either. An agent appending a tool id to a granted grant (or
  // swapping its hash) is a silent widening — force it back to `requested` so the
  // operator re-approves the new surface. Both the RPC replace path
  // (`replaceSanitized`) and the agent-tool path (`sanitizeAgentWorkspaceReplace`)
  // run through here, so this single gate closes both.
  //
  // The OPERATOR-ONLY surface of a granted grant is (a) the authorized `tools`/`toolsHash`
  // (SPEC §17.1), (b) the `autoConfirm` "always allow" set (SPEC §17.2, #62), (c) the
  // `expiresAt` TTL (SPEC §17 TTLs, #64), and (d) the `agents` per-agent scope (SPEC §17.3,
  // #59). None may be MUTATED through replace/import: an agent appending a tool, ticking an
  // auto-confirm, extending a lease, or WIDENING the agent scope (dropping `agents`, or
  // adding an actor) is a silent widening. Any drift in ANY of these on a still-granted
  // grant re-pends the whole grant to `requested` so the operator re-approves the new
  // surface — the single gate closes every no-agent-write path (agent workspace.replace,
  // raw RPC replace, import). Operator-side narrowing is done through the approve verb, not
  // here, so re-pend-on-any-drift is correct: this path never carries operator intent.
  const currentCaps = current.capabilitiesRegistry ?? {};
  const incomingCaps = incoming.capabilitiesRegistry ?? {};
  for (const [name, grant] of Object.entries(incomingCaps)) {
    const currentGrant = currentCaps[name];
    const selfElevated = grant.status === "granted" && currentGrant?.status !== "granted";
    const surfaceMutated =
      grant.status === "granted" &&
      currentGrant?.status === "granted" &&
      (!sameStringSet(grant.tools ?? [], currentGrant.tools ?? []) ||
        (grant.toolsHash ?? "") !== (currentGrant.toolsHash ?? "") ||
        !sameStringSet(grant.autoConfirm ?? [], currentGrant.autoConfirm ?? []) ||
        (grant.expiresAt ?? "") !== (currentGrant.expiresAt ?? "") ||
        !sameStringSet(grant.agents ?? [], currentGrant.agents ?? []));
    if (selfElevated || surfaceMutated) {
      grant.status = "requested";
      delete grant.grantedBy;
      delete grant.grantedAt;
      // A re-pended grant carries no active auto-run, lease, or scope — strip the
      // operator-only fields so a self-grant smuggled through replace can never resurrect
      // them (and a widened scope never rides along on a re-pended grant).
      delete grant.autoConfirm;
      delete grant.expiresAt;
      delete grant.agents;
    }
  }
  return incoming;
}

/**
 * True set equality for two string lists (grant tool-surface comparison) —
 * order- AND duplicate-insensitive. A length compare + one-way membership was
 * WRONG when one side carried a repeated id: `["x","y"]` vs `["x","x"]` are the
 * same length and every element of the first is in the second's Set, so a real
 * surface swap could evade the re-pend gate. Compare de-duplicated sets both ways.
 */
function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) {
    return false;
  }
  for (const entry of setA) {
    if (!setB.has(entry)) {
      return false;
    }
  }
  return true;
}

function assertWorkspaceSize(serialized: string): void {
  if (utf8ByteLength(serialized) > MAX_WORKSPACE_BYTES) {
    throw new Error("workspace document exceeds 256 KB");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Defensively normalize a persisted widget-state envelope read from disk. A file
 * that predates this format (or was hand-edited) still yields a usable record; the
 * `blob` is passed through opaquely (the widget owns its own shape).
 */
function validateWidgetStateRecord(value: unknown): WidgetStateRecord {
  if (!isRecord(value)) {
    throw new Error("widget state file is malformed");
  }
  const version =
    typeof value.version === "number" && Number.isInteger(value.version) && value.version >= 0
      ? value.version
      : 0;
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : "";
  return { version, updatedAt, blob: (value.blob ?? null) as JsonValue };
}

/**
 * Drop ephemeral widgets whose `expiresAt` is at or before `nowMs` (Living
 * Answers TTL sweep). Returns a new doc with `workspaceVersion` bumped when
 * anything expired, or null when nothing did — so the caller writes exactly once
 * and only when the sweep changed something.
 */
function sweepExpiredEphemeral(doc: WorkspaceDoc, nowMs: number): WorkspaceDoc | null {
  let removed = false;
  const tabs = doc.tabs.map((tab) => {
    const widgets = tab.widgets.filter((widget) => {
      const expiresAt = widget.ephemeral?.expiresAt;
      if (expiresAt === undefined) {
        return true;
      }
      const expiry = Date.parse(expiresAt);
      // A validated doc always parses; keep an unparseable stamp rather than guess.
      if (Number.isNaN(expiry) || expiry > nowMs) {
        return true;
      }
      removed = true;
      return false;
    });
    return widgets.length === tab.widgets.length ? tab : { ...tab, widgets };
  });
  if (!removed) {
    return null;
  }
  return { ...doc, tabs, workspaceVersion: doc.workspaceVersion + 1 };
}

/**
 * Re-pend capability grants whose TTL has lapsed (SPEC §17 grant TTLs, #64). A
 * `granted` grant with an `expiresAt` at or before `nowMs` flips back to `requested`
 * — the standard re-pend: tools drop from the agent's set next turn, mcp bindings
 * surface `capability_pending`, and (crucially) `autoConfirm` + `agents` are cleared so a
 * lapsed lease can never keep auto-running or stay scoped. `grantedBy`/`grantedAt`/`expiresAt`
 * are stripped,
 * exactly like import re-pend. Returns a version-bumped doc when anything expired, or
 * null when nothing did — so `read()` writes exactly once, folded with the ephemeral
 * sweep. Mirrors `sweepExpiredEphemeral`: SWEEP ON READ is the universal, fail-closed
 * mechanism (every reader — the engine gate, the agent-tool cache, the approvals view —
 * goes through `read()`, so none can ever observe a stale-granted lapsed lease).
 */
function sweepExpiredGrants(doc: WorkspaceDoc, nowMs: number): WorkspaceDoc | null {
  const registry = doc.capabilitiesRegistry;
  if (!registry) {
    return null;
  }
  let expired = false;
  const next: Record<string, (typeof registry)[string]> = {};
  for (const [name, grant] of Object.entries(registry)) {
    const expiresAt = grant.status === "granted" ? grant.expiresAt : undefined;
    if (expiresAt === undefined) {
      next[name] = grant;
      continue;
    }
    const expiry = Date.parse(expiresAt);
    // A validated doc always parses; keep an unparseable stamp rather than guess.
    if (Number.isNaN(expiry) || expiry > nowMs) {
      next[name] = grant;
      continue;
    }
    expired = true;
    // A lapsed lease re-pends bare: strip provenance, the lease, the auto-run set, AND the
    // per-agent scope (SPEC §17.3, #59) — the operator re-scopes on re-approval.
    const {
      grantedBy: _by,
      grantedAt: _at,
      expiresAt: _exp,
      autoConfirm: _auto,
      agents: _agents,
      ...rest
    } = grant;
    next[name] = { ...rest, status: "requested" };
  }
  if (!expired) {
    return null;
  }
  return {
    ...doc,
    capabilitiesRegistry: next,
    workspaceVersion: doc.workspaceVersion + 1,
  };
}

export class DashboardStore {
  readonly stateDir: string;
  readonly dashboardDir: string;
  readonly workspacePath: string;
  readonly undoDir: string;
  readonly widgetStateDir: string;
  private readonly storage: StorageAdapter;
  private readonly now: () => number;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: { storage: StorageAdapter; now?: () => number }) {
    // Storage is required and injected — the store never reaches for a default fs
    // adapter, so `@boardstate/core` stays browser-safe. Node hosts pass
    // `FsStorageAdapter` from `@boardstate/core/node`; browsers pass `MemoryStorageAdapter`.
    this.storage = options.storage;
    this.stateDir = this.storage.storageDir();
    this.dashboardDir = joinLogical(this.stateDir, "dashboard");
    this.workspacePath = joinLogical(this.dashboardDir, "workspace.json");
    this.undoDir = joinLogical(this.dashboardDir, "undo");
    this.widgetStateDir = joinLogical(this.dashboardDir, "state");
    this.now = options.now ?? (() => Date.now());
  }

  private async readJsonFile(filePath: string): Promise<unknown> {
    const raw = await this.storage.readFile(filePath);
    if (raw === null) {
      return undefined;
    }
    return JSON.parse(raw) as unknown;
  }

  async read(): Promise<WorkspaceDoc> {
    const raw = await this.readJsonFile(this.workspacePath);
    if (raw === undefined) {
      const seeded = validateWorkspaceDoc(structuredClone(DEFAULT_DASHBOARD_WORKSPACE));
      await this.writeWorkspaceDoc(seeded);
      return seeded;
    }
    const migrated = migrateWorkspaceDoc(raw);
    let doc = migrated.doc;
    let mustWrite = migrated.changed;
    // Living Answers TTL: expired ephemeral widgets are swept lazily on read, in a
    // single atomic write folded together with any migration write above.
    const swept = sweepExpiredEphemeral(doc, this.now());
    if (swept) {
      doc = swept;
      mustWrite = true;
    }
    // Grant TTL (SPEC §17, #64): lapsed capability leases re-pend to `requested` on the
    // same lazy-read sweep, folded into the one write below. This is the universal,
    // fail-closed choke point — the engine gate, the agent-tool cache, and the approvals
    // view all read through here, so none can act on a stale-granted expired lease.
    const sweptGrants = sweepExpiredGrants(doc, this.now());
    if (sweptGrants) {
      doc = sweptGrants;
      mustWrite = true;
    }
    if (mustWrite) {
      await this.writeWorkspaceDoc(doc);
    }
    return doc;
  }

  async mutate(
    fn: (draft: WorkspaceDoc) => WorkspaceDoc | void | Promise<WorkspaceDoc | void>,
    _options: DashboardMutationOptions,
  ): Promise<DashboardMutationResult> {
    return await this.runExclusive(async () => {
      const current = await this.read();
      const draft = structuredClone(current);
      const returned = await fn(draft);
      const candidate = returned === undefined ? draft : returned;
      candidate.workspaceVersion = current.workspaceVersion + 1;
      const next = validateWorkspaceDoc(candidate);
      const serialized = serializeWorkspaceDoc(next);
      assertWorkspaceSize(serialized);
      await this.writeUndoSnapshot(current, next.workspaceVersion);
      await this.writeWorkspaceSerialized(serialized);
      return { doc: next, changed: true };
    });
  }

  async replace(
    doc: WorkspaceDoc,
    options: DashboardMutationOptions,
  ): Promise<DashboardMutationResult> {
    return await this.mutate(() => structuredClone(doc), options);
  }

  /**
   * Like `replace`, but enforces the approval invariant (SPEC §8.2) against the
   * CURRENT document, inside the write lock (no TOCTOU): a caller-supplied doc can
   * never ELEVATE a custom widget to `approved`. Every UNTRUSTED entry point (the
   * `dashboard.workspace.replace` RPC, imports) MUST use this; `replace` itself
   * stays a trusted primitive for seeding, restore, and undo.
   */
  async replaceSanitized(
    doc: WorkspaceDoc,
    options: DashboardMutationOptions,
  ): Promise<DashboardMutationResult> {
    return await this.mutate(
      (current) => reconcileReplaceApproval(structuredClone(doc), current),
      options,
    );
  }

  async undo(): Promise<WorkspaceDoc> {
    return await this.runExclusive(async () => {
      const files = await this.listUndoFiles();
      const newest = files.at(-1);
      if (!newest) {
        throw new Error("no dashboard undo snapshot available");
      }
      const snapshotPath = joinLogical(this.undoDir, newest);
      const snapshot = validateWorkspaceDoc(await this.readJsonFile(snapshotPath));
      const serialized = serializeWorkspaceDoc(snapshot);
      assertWorkspaceSize(serialized);
      await this.writeWorkspaceSerialized(serialized);
      await this.storage.rm(snapshotPath);
      return snapshot;
    });
  }

  /**
   * List undo-ring snapshots newest-first as metadata only (history.list). Reads
   * the ring but never mutates it, so it needs no exclusive lock. `bytes` is the
   * on-disk serialized size; `savedAt` is derived from the snapshot's own version.
   * Snapshots that fail validation are skipped rather than failing the whole listing.
   *
   * Each entry also carries a compact `summary` of what changed to reach it — the
   * diff against the next-older snapshot in the ring, condensed to counts + the
   * dominant actor. It is computed here, at read time, from the same bodies the
   * listing already parses, so the undo ring on disk stays metadata-free (its size
   * caps are untouched). The oldest snapshot has no predecessor and so no summary.
   */
  async listHistory(): Promise<DashboardHistoryEntry[]> {
    const files = await this.listUndoFiles();
    const loaded = await Promise.all(
      files.map(async (fileName) => {
        const filePath = joinLogical(this.undoDir, fileName);
        try {
          const content = await this.storage.readFile(filePath);
          if (content === null) {
            return undefined;
          }
          const doc = validateWorkspaceDoc(JSON.parse(content) as unknown);
          return {
            version: doc.workspaceVersion,
            savedAt: new Date().toISOString(),
            bytes: utf8ByteLength(content),
            workspace: normalizeWorkspace(doc),
          };
        } catch {
          return undefined;
        }
      }),
    );
    // Newest-first for display; the predecessor of each entry is therefore the NEXT
    // item in this array (the next-lower version still present in the ring).
    const ordered = loaded
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
      .toSorted((a, b) => b.version - a.version);
    return ordered.map(({ version, savedAt, bytes, workspace }, index) => {
      const previous = ordered[index + 1]?.workspace;
      const summary = previous
        ? summarizeWorkspaceDiff(computeWorkspaceDiff(previous, workspace))
        : undefined;
      return summary ? { version, savedAt, bytes, summary } : { version, savedAt, bytes };
    });
  }

  /**
   * Return the full snapshot doc for a ring `version` (history.get), or throw if it
   * is no longer in the ring. Read-only; matches on the snapshot's own
   * `workspaceVersion` so callers never depend on the ring filename offset.
   */
  async getHistorySnapshot(version: number): Promise<WorkspaceDoc> {
    const files = await this.listUndoFiles();
    for (const fileName of files) {
      const raw = await this.readJsonFile(joinLogical(this.undoDir, fileName));
      if (raw === undefined) {
        continue;
      }
      const doc = validateWorkspaceDoc(raw);
      if (doc.workspaceVersion === version) {
        return doc;
      }
    }
    throw new Error(`no dashboard history snapshot for version ${version}`);
  }

  /**
   * Resolve the on-disk file for one widget's persisted state. The charset guard
   * already forbids separators / traversal, but containment is re-checked so the
   * resolved path can never escape the `state/` jail (belt-and-braces).
   */
  private resolveWidgetStatePath(widgetId: string): string {
    if (!WIDGET_ID_PATTERN.test(widgetId)) {
      throw new Error("widget id is invalid");
    }
    const stateRoot = this.widgetStateDir;
    const filePath = joinLogical(stateRoot, `${widgetId}.json`);
    if (!filePath.startsWith(`${stateRoot}${LOGICAL_SEP}`)) {
      throw new Error("widget id is invalid");
    }
    return filePath;
  }

  /** Read a widget's persisted state envelope, or null if it has never been written. */
  async readWidgetState(widgetId: string): Promise<WidgetStateRecord | null> {
    const filePath = this.resolveWidgetStatePath(widgetId);
    const raw = await this.readJsonFile(filePath);
    if (raw === undefined) {
      return null;
    }
    return validateWidgetStateRecord(raw);
  }

  /**
   * Persist a widget's opaque blob under `state/<widgetId>.json`. The serialized
   * envelope is size-capped BEFORE the write, so an oversize blob is rejected WHOLE
   * (nothing is written). Writes are serialized through the process mutex and land
   * atomically; the version increments per successful write for change markers.
   *
   * Optimistic concurrency: when `opts.expectedVersion` is supplied, the write only
   * proceeds if it matches the current persisted version (0 = never written) —
   * otherwise it rejects WHOLE with a conflict, so two clients editing the same
   * widget can't silently lose each other's updates. Omitting it preserves the
   * original last-write-wins behavior.
   */
  async writeWidgetState(
    widgetId: string,
    blob: JsonValue,
    opts: { expectedVersion?: number } = {},
  ): Promise<WidgetStateWriteResult> {
    const filePath = this.resolveWidgetStatePath(widgetId);
    return await this.runExclusive(async () => {
      const previous = await this.readWidgetState(widgetId).catch(() => null);
      const currentVersion = previous?.version ?? 0;
      if (opts.expectedVersion !== undefined && opts.expectedVersion !== currentVersion) {
        throw new Error(
          `widget state version conflict: expected ${opts.expectedVersion}, found ${currentVersion}`,
        );
      }
      const record: WidgetStateRecord = {
        version: currentVersion + 1,
        updatedAt: new Date().toISOString(),
        blob,
      };
      const serialized = `${JSON.stringify(record, null, 2)}\n`;
      if (utf8ByteLength(serialized) > MAX_WIDGET_STATE_BYTES) {
        throw new Error("widget state exceeds 64 KB");
      }
      await this.storage.mkdir(this.widgetStateDir, { mode: 0o700 });
      await this.storage.writeFileAtomic(filePath, serialized, { mode: 0o600 });
      return { version: record.version };
    });
  }

  private async runExclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    // One gateway process is the only writer; this promise chain serializes
    // all RPC/tool/CLI callers so read-modify-write cycles cannot interleave.
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return await next;
  }

  private async writeWorkspaceDoc(doc: WorkspaceDoc): Promise<void> {
    const serialized = serializeWorkspaceDoc(doc);
    assertWorkspaceSize(serialized);
    await this.writeWorkspaceSerialized(serialized);
  }

  private async writeWorkspaceSerialized(serialized: string): Promise<void> {
    await this.storage.mkdir(this.dashboardDir, { mode: 0o700 });
    await this.storage.writeFileAtomic(this.workspacePath, serialized, { mode: 0o600 });
  }

  private async writeUndoSnapshot(doc: WorkspaceDoc, nextWorkspaceVersion: number): Promise<void> {
    await this.storage.mkdir(this.undoDir, { mode: 0o700 });
    await this.storage.writeFileAtomic(
      joinLogical(this.undoDir, `${String(nextWorkspaceVersion).padStart(4, "0")}.json`),
      serializeWorkspaceDoc(doc),
      { mode: 0o600 },
    );
    const files = await this.listUndoFiles();
    const evict = files.slice(0, Math.max(0, files.length - UNDO_RING_SIZE));
    await Promise.all(
      evict.map((fileName) => this.storage.rm(joinLogical(this.undoDir, fileName))),
    );
  }

  private async listUndoFiles(): Promise<string[]> {
    return (await this.storage.readdir(this.undoDir))
      .filter((fileName) => /^\d+\.json$/.test(fileName))
      .toSorted();
  }
}
