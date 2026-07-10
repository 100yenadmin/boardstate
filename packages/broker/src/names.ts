// Two names for every discovered tool, both budget-capped at 64 chars:
//
//   manifest id    `connector:tool`   — the broker's internal, human-readable handle.
//                                        `:` is deliberate: it can never collide with a
//                                        raw tool name and marks the namespace boundary.
//   provider name  `connector__tool`   — a name legal in an LLM provider's tool-name
//                                        charset `^[A-Za-z0-9_-]{1,64}$` (no `:`). This
//                                        is what the M5c-1 adapter (#42) hands the model;
//                                        exporting it HERE stops that adapter from
//                                        inventing its own scheme.
//
// Sanitizing `connector`/`tool` into the provider charset is lossy (a `.` and a `-`
// both become `_`), so the provider name is NOT reversible by string surgery. The
// broker instead keeps an explicit provider-name -> manifest-id map, built once per
// manifest, and fails LOUD on any collision — cf. the reverse-map discipline in
// `toAgentToolName` (packages/mcp/src/mcp-server.ts:77), inverted for the outbound side.

import { BrokerBudgetError, BrokerNameCollisionError } from "./errors.js";

/** Provider tool-name charset (Anthropic/OpenAI function names): letters, digits, `_`, `-`. */
export const PROVIDER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Separator between namespace and tool in the internal manifest id. */
export const MANIFEST_ID_SEPARATOR = ":";

/** Separator between namespace and tool in the provider-safe name. */
export const PROVIDER_NAME_SEPARATOR = "__";

/** The shared 64-char budget both names are measured against. */
export const NAME_BUDGET = 64;

/** Build the internal `connector:tool` manifest id, enforcing the 64-char budget. */
export function manifestId(connector: string, tool: string): string {
  const id = `${connector}${MANIFEST_ID_SEPARATOR}${tool}`;
  if (id.length > NAME_BUDGET) {
    throw new BrokerBudgetError(
      `manifest id "${id}" is ${id.length} chars (budget ${NAME_BUDGET}); shorten the connector prefix or tool name`,
    );
  }
  return id;
}

/** Split a `connector:tool` id back into its parts (first `:` wins — tool names may contain none). */
export function parseManifestId(id: string): { connector: string; tool: string } {
  const idx = id.indexOf(MANIFEST_ID_SEPARATOR);
  if (idx <= 0 || idx === id.length - 1) {
    throw new BrokerBudgetError(`"${id}" is not a valid connector:tool manifest id`);
  }
  return { connector: id.slice(0, idx), tool: id.slice(idx + 1) };
}

/** Replace every char outside the provider charset with `_` (lossy). */
function sanitizeSegment(segment: string): string {
  return segment.replace(/[^A-Za-z0-9-]/g, "_");
}

/**
 * Build the provider-safe `connector__tool` name for one tool, enforcing the budget.
 * Lossy per-segment sanitization means callers MUST record the (name -> id) mapping and
 * detect collisions themselves — {@link buildProviderNameMap} does exactly that.
 */
export function toProviderName(connector: string, tool: string): string {
  const name = `${sanitizeSegment(connector)}${PROVIDER_NAME_SEPARATOR}${sanitizeSegment(tool)}`;
  if (!PROVIDER_NAME_PATTERN.test(name)) {
    // Only reachable via the length bound: sanitizeSegment already coerces the charset.
    throw new BrokerBudgetError(
      `provider name "${name}" is ${name.length} chars (budget ${NAME_BUDGET})`,
    );
  }
  return name;
}

/**
 * Map every manifest id to its provider-safe name and back. Throws {@link
 * BrokerNameCollisionError} the moment two distinct ids sanitize to the same provider
 * name (e.g. `slack.io:send` and `slack-io:send`) — the broker will not silently route
 * one tool's calls to another.
 */
export function buildProviderNameMap(ids: readonly string[]): {
  idToProvider: Map<string, string>;
  providerToId: Map<string, string>;
} {
  const idToProvider = new Map<string, string>();
  const providerToId = new Map<string, string>();
  for (const id of ids) {
    const { connector, tool } = parseManifestId(id);
    const provider = toProviderName(connector, tool);
    const clash = providerToId.get(provider);
    if (clash !== undefined && clash !== id) {
      throw new BrokerNameCollisionError(
        `provider name "${provider}" is claimed by both "${clash}" and "${id}"; ` +
          `give the connectors distinct provider-legal prefixes`,
      );
    }
    idToProvider.set(id, provider);
    providerToId.set(provider, id);
  }
  return { idToProvider, providerToId };
}
