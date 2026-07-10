// The `ToolManifest`: the broker's snapshot of every tool across every connected
// connector, plus a stable hash over it. The hash is the anti-rug-pull anchor the grant
// lifecycle (M5b-2) pins a grant to — if a server later adds/removes/renames a tool or
// changes a tool's input schema, the hash changes and the grant must be re-approved.
//
// readOnlyHint honored, fail-safe: a tool with `readOnlyHint: true` is `readOnly: true`;
// ABSENT (or false) ⇒ `readOnly: false`, i.e. treated as a mutation. This mirrors the
// AgentTool convention in packages/server/src/host.ts:42-54 (`readOnly?` absent ⇒ treat
// as a mutation) so the two layers can never disagree on what is safe to run.

import { createHash } from "node:crypto";
import type { AgentTool } from "@boardstate/server";
import { buildProviderNameMap, manifestId } from "./names.js";

/** A discovered MCP tool annotation subset the broker cares about. */
export type ToolAnnotations = {
  readOnlyHint?: boolean;
};

/** The raw tool shape the SDK's `listTools()` returns (the fields we consume). */
export type DiscoveredTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
};

export type ToolManifestEntry = {
  /** Internal `connector:tool` id. */
  id: string;
  /** Provider-safe `connector__tool` name (LLM function-name charset). */
  providerName: string;
  /** The owning connector's config name. */
  connector: string;
  /** The tool's raw name on its server (namespace stripped). */
  tool: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  /**
   * True only when the server set `readOnlyHint: true`. Absent hint ⇒ false (mutation) —
   * the fail-safe default. Type-aligned with {@link AgentTool.readOnly}.
   */
  readOnly: AgentTool["readOnly"];
};

export type ToolManifest = {
  /** Every discovered tool, sorted by manifest id for determinism. */
  tools: ToolManifestEntry[];
  /** Stable sha256 over the sorted (id + canonical input schema) pairs. */
  hash: string;
  /** manifest id -> provider-safe name. */
  idToProvider: Map<string, string>;
  /** provider-safe name -> manifest id (the reverse lookup the M5c-1 adapter needs). */
  providerToId: Map<string, string>;
};

/** Recursively sort object keys so semantically equal schemas serialize identically. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Hash the sorted (manifest id + canonical input schema + readOnly) tuples.
 * Deterministic across runs and process boundaries; changes iff a tool is added,
 * removed, renamed, its input schema changes, or its readOnly classification flips.
 * readOnly MUST participate: it decides direct-execute vs pending-action downstream,
 * so a read tool silently becoming a mutation is exactly the rug-pull the hash
 * exists to catch. Description churn deliberately does NOT move the hash — the
 * grant cares about the callable surface, not the prose.
 */
export function manifestHash(entries: readonly ToolManifestEntry[]): string {
  const tuples = entries
    .map((entry) => [entry.id, canonicalize(entry.inputSchema), entry.readOnly] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(tuples)).digest("hex");
}

/**
 * Assemble a {@link ToolManifest} from each connector's discovered tools. Enforces the
 * 64-char budget on both name forms and fails loud on a provider-name collision (both
 * via {@link manifestId} / {@link buildProviderNameMap}). `discovered` maps a connector
 * name to the tools its server returned.
 */
export function buildManifest(discovered: Map<string, DiscoveredTool[]>): ToolManifest {
  const entries: ToolManifestEntry[] = [];
  for (const [connector, tools] of discovered) {
    for (const tool of tools) {
      entries.push({
        id: manifestId(connector, tool.name),
        // Filled in once the id set is known (buildProviderNameMap detects collisions).
        providerName: "",
        connector,
        tool: tool.name,
        ...(tool.description !== undefined ? { description: tool.description } : {}),
        inputSchema: tool.inputSchema,
        readOnly: tool.annotations?.readOnlyHint === true,
      });
    }
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const { idToProvider, providerToId } = buildProviderNameMap(entries.map((entry) => entry.id));
  for (const entry of entries) {
    entry.providerName = idToProvider.get(entry.id) ?? "";
  }

  return { tools: entries, hash: manifestHash(entries), idToProvider, providerToId };
}
