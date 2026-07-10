import {
  COMPUTED_OPS,
  type ComputedOp,
  DATA_READ_RPC_ALLOWLIST,
  normalizeDashboardDataLogicalPath,
  STREAM_EVENT_ALLOWLIST,
} from "./binding-contract.js";

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type DashboardActor = "user" | "system" | `agent:${string}`;
/** Tab visibility: `shared` (default) is visible to every operator; a
 * `private` tab is only serialized to its `owner` operator on the read path. */
export type DashboardTabVisibility = "shared" | "private";
export type DashboardGrid = { x: number; y: number; w: number; h: number };
export type DashboardRpcBinding = { source: "rpc"; method: string };
export type DashboardFileBinding = { source: "file"; path: string; pointer?: string };
export type DashboardStaticBinding = { source: "static"; value: JsonValue };
/**
 * `stream` binding: PUSH updates from an allowlisted gateway broadcast channel.
 * Never opens a new socket — it names one of `STREAM_EVENT_ALLOWLIST`, already
 * multiplexed over the Control UI's gateway WebSocket, and is resolved client-side.
 */
export type DashboardStreamBinding = { source: "stream"; event: string; pointer?: string };
/**
 * `computed` binding: value DERIVED client-side from the already-resolved values of
 * SIBLING bindings (`inputs`, by id) via a fixed whitelisted `op` — never eval, never
 * an expression language. `pick`/`format` carry the single string `arg`.
 */
export type DashboardComputedBinding = {
  source: "computed";
  op: ComputedOp;
  inputs: string[];
  arg?: string;
};
/**
 * `mcp` binding (SPEC §18): READ data from a granted external MCP tool, named by
 * `connector` + `tool` with optional static `args`. This module only VALIDATES the
 * shape — host resolution (calling the broker, gating on a granted tool capability)
 * lands with the broker/read-path work (#45); a validated `mcp` binding never
 * resolves until then. Never carries credentials (SPEC §18: secrets stay node-side).
 */
export type DashboardMcpBinding = {
  source: "mcp";
  connector: string;
  tool: string;
  args?: Record<string, JsonValue>;
};
export type DashboardBinding =
  | DashboardRpcBinding
  | DashboardFileBinding
  | DashboardStaticBinding
  | DashboardStreamBinding
  | DashboardComputedBinding
  | DashboardMcpBinding;
/** Marks a widget as auto-expiring (Living Answers); the store sweeps it once past `expiresAt`. */
export type DashboardEphemeral = { expiresAt: string };
export type DashboardWidget = {
  id: string;
  kind: string;
  title?: string;
  grid: DashboardGrid;
  collapsed: boolean;
  hidden: boolean;
  bindings?: Record<string, DashboardBinding>;
  props?: JsonValue;
  ephemeral?: DashboardEphemeral;
};
export type DashboardTabLayout = "grid" | "full";
export type DashboardTab = {
  slug: string;
  title: string;
  icon?: string;
  hidden: boolean;
  /** Content layout: the default 12-col grid, or a single full-bleed widget. */
  layout?: DashboardTabLayout;
  createdBy: DashboardActor;
  /** `private` tabs are omitted from the workspace doc served to any operator
   * other than `owner` (see the host's read-path filter). Absent === `shared`. */
  visibility?: DashboardTabVisibility;
  /** Operator identity that owns a `private` tab; only that operator may read it. */
  owner?: string;
  widgets: DashboardWidget[];
};
export type DashboardWidgetRegistryEntry = {
  status: "pending" | "approved" | "rejected";
  createdBy: DashboardActor;
  approvedBy?: DashboardActor;
  approvedAt?: string;
};

export type DashboardCapabilityStatus = "requested" | "granted" | "revoked";

/**
 * A data-source capability grant (SPEC §17, M4b). A connector self-declares the
 * allowlisted read methods + stream channels it needs; the entry lands `requested`
 * and an OPERATOR approves it to `granted` before any binding it covers resolves.
 * `methods`/`streams` are the concrete SNAPSHOT the grant authorizes — a connector
 * changing its shape re-requests. Keyed by connector name in `capabilitiesRegistry`.
 */
export type DashboardCapabilityGrant = {
  status: DashboardCapabilityStatus;
  /** Allowlisted `DATA_READ_RPC_ALLOWLIST` methods this connector's reads cover. */
  methods: string[];
  /** Allowlisted `STREAM_EVENT_ALLOWLIST` channels this connector's streams cover. */
  streams: string[];
  /**
   * External MCP tools (SPEC §17 v2) this grant authorizes, each a namespaced
   * `connector:tool` id. UNLIKE `methods`/`streams`, tool ids are NOT drawn from a
   * frozen schema allowlist — the tool space is per-connector and dynamic — so an
   * entry is validated only for shape (`connector:tool`, ≤64 chars). Optional-in;
   * a grant with no external tools omits the key. Partial grants are the approved
   * SUBSET the operator ticked (SPEC §17 v2), not the full requested set.
   */
  tools?: string[];
  /**
   * Anti-rug-pull digest (SPEC §17 v2): a hash over the connector's declared tool
   * manifest at grant time. A later manifest whose hash differs forces a re-request
   * before any tool call succeeds. Opaque here (shape validated, never recomputed).
   */
  toolsHash?: string;
  /**
   * Per-tool auto-confirm (SPEC §17.2, #62): the SUBSET of granted `tools` the operator
   * marked "always allow" — a non-readOnly tool in this set executes DIRECTLY (audited
   * `auto-confirmed`) instead of parking for confirm. OPERATOR-SET ONLY (the approve
   * verb): the agent/tool_search surface can never touch it. Wiped whenever the grant
   * re-pends (anti-rug-pull, TTL expiry) or is revoked — a tool that changed under you,
   * or a lease that lapsed, must not keep auto-run. Every id ⊆ `tools`; validation
   * rejects outsiders + duplicates.
   */
  autoConfirm?: string[];
  /**
   * TTL (SPEC §17, #64): an ISO-8601 instant after which the grant expires back to
   * `requested` (the standard re-pend — tools drop, autoConfirm clears, bindings surface
   * pending). Operator-set at approve time and must be FUTURE-DATED at write (enforced by
   * the approve verb; the shape guard accepts any valid instant so a briefly-past grant
   * survives until the sweep flips it). Absent ⇒ the grant never times out (a deed).
   */
  expiresAt?: string;
  /**
   * Per-agent scope (SPEC §17.3, #59): the SUBSET of agent actors (`agent:<id>`) this
   * grant's tools are usable by — the actor dimension of the AND-gate. ABSENT ⇒ every
   * agent (back-compat, zero migration); PRESENT ⇒ only these actors pass, and any other
   * actor (or an unauthenticated networked caller with no server-bound identity) is
   * refused `capability_pending`. OPERATOR-SET ONLY (the approve verb): REQUEST / reconcile
   * / import can never write or widen it — a drift on a still-granted grant re-pends the
   * whole grant, exactly like `autoConfirm`/`expiresAt`, and every re-pend strips it. Only
   * agent actors (never `user`/`system`), non-empty when present (absent already means
   * "all"), no duplicates.
   */
  agents?: string[];
  /** Human-readable one-liner for the approval card. */
  description?: string;
  grantedBy?: DashboardActor;
  grantedAt?: string;
};

export type PendingActionStatus = "pending" | "confirmed" | "denied" | "expired";

/**
 * A server-enforced pending side-effecting action (SPEC §18). The M5b-3 engine
 * (#41) PERSISTS this shape: a non-readOnly tool call is parked `pending` until an
 * OPERATOR confirms (`dashboard.action.confirm`, operator-only) or it is denied /
 * expires. This module contributes only the TYPE + `validatePendingAction` shape
 * guard — no lifecycle, no store, no confirm wiring (all #41).
 */
export type PendingActionRecord = {
  id: string;
  connector: string;
  tool: string;
  /** The concrete arguments the parked call would invoke the tool with. */
  args: Record<string, JsonValue>;
  /** Agent that requested the action, when it carries agent provenance. */
  requestedBy?: DashboardActor;
  createdAt: string;
  expiresAt: string;
  status: PendingActionStatus;
};

export type WorkspaceDoc = {
  schemaVersion: 1;
  workspaceVersion: number;
  tabs: DashboardTab[];
  widgetsRegistry: Record<string, DashboardWidgetRegistryEntry>;
  /**
   * Data-source capability grants (SPEC §17), keyed by connector name. Optional on
   * INPUT (pre-§17 docs and code-built literals may omit it); `validateWorkspaceDoc`
   * always returns it populated (`{}` when absent), so a validated doc always has it.
   */
  capabilitiesRegistry?: Record<string, DashboardCapabilityGrant>;
  prefs: { tabOrder: string[] };
};

export const CURRENT_WORKSPACE_SCHEMA_VERSION = 1;

const TAB_SLUG_PATTERN = /^[a-z0-9-]{1,40}$/;
const ACTOR_PATTERN = /^(user|system|agent:[A-Za-z0-9._-]{1,64})$/;
// A grant's per-agent scope (SPEC §17.3) lists ONLY agent actors — `user`/`system` are
// never scope targets (scoping governs agents), so this is stricter than ACTOR_PATTERN.
const AGENT_ACTOR_PATTERN = /^agent:[A-Za-z0-9._-]{1,64}$/;
const TAB_VISIBILITY_VALUES = new Set<DashboardTabVisibility>(["shared", "private"]);
/** Bounded opaque operator-identity string (e.g. `device:<id>`). */
const TAB_OWNER_PATTERN = /^[A-Za-z0-9:._-]{1,128}$/;
const WIDGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,48}$/;
const BUILTIN_KIND_PATTERN =
  /^builtin:(stat-card|markdown|table|iframe-embed|sessions|usage|cron|instances|activity|chart|notes|action-form|action-button|preview|agent-status|approvals|chat)$/;
const CUSTOM_KIND_PATTERN = /^custom:[A-Za-z0-9._-]{1,64}$/;
const CUSTOM_WIDGET_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
// A connector (broker) name: same bounded alphabet used to key `capabilitiesRegistry`.
const CONNECTOR_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
// A single external tool NAME (the part after `connector:` in a grant id, and the
// `tool` prop of an mcp binding / action widget). Bounded, no separators.
const CONNECTOR_TOOL_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
// A namespaced grant tool id: `connector:tool`. The connector segment shares
// CONNECTOR_NAME_PATTERN's alphabet and the tool segment CONNECTOR_TOOL_PATTERN's,
// separated by exactly one colon; the whole id is additionally capped at
// GRANT_TOOL_ID_MAX_LENGTH so `{1,64}:{1,64}` can't stretch past the 64-char bound.
// NOT validated against DATA_READ_RPC_ALLOWLIST — external tools are not read RPCs.
const GRANT_TOOL_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}:[A-Za-z0-9._-]{1,64}$/;
const GRANT_TOOL_ID_MAX_LENGTH = 64;
// Opaque anti-rug-pull digest + pending-action id: bounded opaque tokens.
const TOOLS_HASH_PATTERN = /^[A-Za-z0-9._+/=-]{1,128}$/;
const PENDING_ACTION_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
// Args objects (mcp binding + action widgets + pending action) are bounded JSON
// objects — the same 8 KB envelope a static binding gets.
const MAX_ARGS_BINDING_BYTES = 8 * 1024;
const BINDING_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_STATIC_BINDING_BYTES = 8 * 1024;
const MAX_COMPUTED_INPUTS = 32;
// ISO 8601 date-time with an explicit timezone (Z or ±HH:MM). Ephemeral expiries
// are compared against Date.now() at read time, so the offset must be unambiguous.
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
// builtin:action-form caps. The template is workspace-authored and versioned; only
// declared field VALUES vary per click, so both the template and the field set are
// hard-bounded at write time and each slot must name a declared field.
const ACTION_FORM_FIELD_NAME_PATTERN = /^[A-Za-z0-9_]{1,32}$/;
// Same alphabet as the UI interpolation matcher — keep in sync.
const ACTION_FORM_SLOT_PATTERN = /\{([A-Za-z0-9_]+)\}/g;
const ACTION_FORM_MAX_TEMPLATE_CHARS = 2000;
const ACTION_FORM_MAX_FIELDS = 8;
const ACTION_FORM_MAX_OPTIONS = 20;
const ACTION_FORM_MAX_FIELD_MAX_LENGTH = 1000;
const ACTION_FORM_FIELD_TYPES = ["text", "number", "select"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value;
}

function assertKnownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new Error(`${path}.${key} is not allowed`);
    }
  }
}

function requireString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`${path}.${key} must be a string`);
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  path: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${path}.${key} must be a string`);
  }
  return value;
}

function requireBoolean(record: Record<string, unknown>, key: string, path: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`${path}.${key} must be a boolean`);
  }
  return value;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }
  return value;
}

function validateActor(value: unknown, path: string): DashboardActor {
  if (typeof value !== "string" || !ACTOR_PATTERN.test(value)) {
    throw new Error(`${path} createdBy is invalid`);
  }
  return value as DashboardActor;
}

export function isDashboardActor(value: unknown): value is DashboardActor {
  return typeof value === "string" && ACTOR_PATTERN.test(value);
}

function assertIntegerRange(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${path} must be an integer from ${min} to ${max}`);
  }
  return value as number;
}

function validateGrid(value: unknown, path: string): DashboardGrid {
  const record = assertRecord(value, path);
  assertKnownKeys(record, ["x", "y", "w", "h"], path);
  const grid = {
    x: assertIntegerRange(record.x, `${path}.x`, 0, 11),
    y: assertIntegerRange(record.y, `${path}.y`, 0, 499),
    w: assertIntegerRange(record.w, `${path}.w`, 1, 12),
    h: assertIntegerRange(record.h, `${path}.h`, 1, 20),
  };
  if (grid.x + grid.w > 12) {
    throw new Error(`${path}.x + w must be 12 or less`);
  }
  return grid;
}

function assertJsonValue(value: unknown, path: string): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => assertJsonValue(entry, `${path}[${index}]`));
  }
  if (isRecord(value)) {
    const next: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      next[key] = assertJsonValue(entry, `${path}.${key}`);
    }
    return next;
  }
  throw new Error(`${path} must be JSON-serializable`);
}

function serializedBytes(value: unknown): number {
  // TextEncoder (browser + node), not Buffer — keeps @boardstate/schema browser-safe.
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function validateBinding(value: unknown, path: string): DashboardBinding {
  const record = assertRecord(value, path);
  const source = requireString(record, "source", path);
  if (source === "rpc") {
    assertKnownKeys(record, ["source", "method"], path);
    const method = requireString(record, "method", path);
    if (!DATA_READ_RPC_ALLOWLIST.includes(method as (typeof DATA_READ_RPC_ALLOWLIST)[number])) {
      throw new Error(`${path}.method is not allowlisted`);
    }
    return { source, method };
  }
  if (source === "file") {
    assertKnownKeys(record, ["source", "path", "pointer"], path);
    const bindingPath = requireString(record, "path", path);
    normalizeDashboardDataLogicalPath(bindingPath);
    const pointer = optionalString(record, "pointer", path);
    return { source, path: bindingPath, ...(pointer !== undefined ? { pointer } : {}) };
  }
  if (source === "static") {
    assertKnownKeys(record, ["source", "value"], path);
    const jsonValue = assertJsonValue(record.value, `${path}.value`);
    if (serializedBytes(jsonValue) > MAX_STATIC_BINDING_BYTES) {
      throw new Error(`${path}.value must serialize to 8 KB or less`);
    }
    return { source, value: jsonValue };
  }
  if (source === "stream") {
    assertKnownKeys(record, ["source", "event", "pointer"], path);
    const event = requireString(record, "event", path);
    if (!STREAM_EVENT_ALLOWLIST.includes(event as (typeof STREAM_EVENT_ALLOWLIST)[number])) {
      throw new Error(`${path}.event is not allowlisted`);
    }
    const pointer = optionalString(record, "pointer", path);
    if (pointer !== undefined && !pointer.startsWith("/")) {
      throw new Error(`${path}.pointer must be a JSON pointer`);
    }
    return { source, event, ...(pointer !== undefined ? { pointer } : {}) };
  }
  if (source === "computed") {
    assertKnownKeys(record, ["source", "op", "inputs", "arg"], path);
    const op = requireString(record, "op", path);
    if (!COMPUTED_OPS.includes(op as ComputedOp)) {
      throw new Error(`${path}.op is not a valid computed op`);
    }
    const rawInputs = requireArray(record.inputs, `${path}.inputs`);
    if (rawInputs.length < 1 || rawInputs.length > MAX_COMPUTED_INPUTS) {
      throw new Error(`${path}.inputs must contain 1 to ${MAX_COMPUTED_INPUTS} entries`);
    }
    const inputs = rawInputs.map((entry, index) => {
      if (typeof entry !== "string" || !BINDING_ID_PATTERN.test(entry)) {
        throw new Error(`${path}.inputs[${index}] is invalid`);
      }
      return entry;
    });
    // `pick`/`format` require the single string `arg`; every other op forbids it.
    const needsArg = op === "pick" || op === "format";
    const arg = optionalString(record, "arg", path);
    if (needsArg && (arg === undefined || arg.length === 0)) {
      throw new Error(`${path}.arg is required for the ${op} op`);
    }
    if (!needsArg && arg !== undefined) {
      throw new Error(`${path}.arg is not allowed for the ${op} op`);
    }
    if (op === "pick" && arg !== undefined && !arg.startsWith("/")) {
      throw new Error(`${path}.arg must be a JSON pointer for the pick op`);
    }
    return { source, op: op as ComputedOp, inputs, ...(arg !== undefined ? { arg } : {}) };
  }
  if (source === "mcp") {
    // Shape-only (SPEC §18): host resolution + the granted-tool AND-gate land with
    // the broker read path (#45). A validated `mcp` binding never resolves here.
    assertKnownKeys(record, ["source", "connector", "tool", "args"], path);
    const connector = requireString(record, "connector", path);
    if (!CONNECTOR_NAME_PATTERN.test(connector)) {
      throw new Error(`${path}.connector is invalid`);
    }
    const tool = requireString(record, "tool", path);
    if (!CONNECTOR_TOOL_PATTERN.test(tool)) {
      throw new Error(`${path}.tool is invalid`);
    }
    const args = validateArgsObject(record.args, `${path}.args`);
    return { source, connector, tool, ...(args !== undefined ? { args } : {}) };
  }
  throw new Error(`${path}.source is invalid`);
}

/**
 * Validate an optional `args` object (mcp binding, action-button, pending action):
 * a JSON OBJECT (never a scalar/array) bounded to the 8 KB static-binding envelope.
 * Returns the frozen JSON value, or `undefined` when the key is absent.
 */
function validateArgsObject(value: unknown, path: string): Record<string, JsonValue> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const json = assertJsonValue(value, path);
  if (!isRecord(json)) {
    throw new Error(`${path} must be an object`);
  }
  if (serializedBytes(json) > MAX_ARGS_BINDING_BYTES) {
    throw new Error(`${path} must serialize to 8 KB or less`);
  }
  return json;
}

function validateBindingRecord(value: unknown, path: string): Record<string, DashboardBinding> {
  const record = assertRecord(value, path);
  const bindings: Record<string, DashboardBinding> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (!BINDING_ID_PATTERN.test(key)) {
      throw new Error(`${path}.${key} binding id is invalid`);
    }
    bindings[key] = validateBinding(entry, `${path}.${key}`);
  }
  // Cross-binding pass for `computed`: every input must name an existing SIBLING
  // binding that is NOT itself `computed`. Forbidding computed→computed makes a
  // reference cycle structurally impossible (a computed depends only on leaf
  // bindings), so no graph walk is needed — this is the cycle policy.
  for (const [key, binding] of Object.entries(bindings)) {
    if (binding.source !== "computed") {
      continue;
    }
    for (const input of binding.inputs) {
      const target = bindings[input];
      if (!target) {
        throw new Error(`${path}.${key}.inputs references unknown binding: ${input}`);
      }
      if (target.source === "computed") {
        throw new Error(
          `${path}.${key}.inputs may not reference another computed binding: ${input}`,
        );
      }
    }
  }
  return bindings;
}

function validateEphemeral(value: unknown, path: string): DashboardEphemeral {
  const record = assertRecord(value, path);
  assertKnownKeys(record, ["expiresAt"], path);
  const expiresAt = requireString(record, "expiresAt", path);
  if (!ISO_TIMESTAMP_PATTERN.test(expiresAt) || Number.isNaN(Date.parse(expiresAt))) {
    throw new Error(`${path}.expiresAt must be an ISO 8601 timestamp`);
  }
  return { expiresAt };
}

/**
 * Write-time validation for a `builtin:action-form` widget's props. The template
 * is authored here (not at click time); each `{slot}` MUST name a declared field,
 * so an operator-approved form can never interpolate an undeclared value. Field
 * values are supplied at click time and are separately typed/length-capped by the
 * renderer — this gate only bounds the authored template + field set.
 */
function validateActionFormProps(value: unknown, path: string): void {
  const record = assertRecord(value, path);
  assertKnownKeys(
    record,
    ["template", "fields", "buttonLabel", "mode", "connector", "tool", "argsFrom"],
    path,
  );
  const template = requireString(record, "template", path);
  if (template.length < 1 || template.length > ACTION_FORM_MAX_TEMPLATE_CHARS) {
    throw new Error(`${path}.template must be 1-${ACTION_FORM_MAX_TEMPLATE_CHARS} characters`);
  }
  const fields = requireArray(record.fields, `${path}.fields`);
  if (fields.length < 1 || fields.length > ACTION_FORM_MAX_FIELDS) {
    throw new Error(`${path}.fields must contain 1 to ${ACTION_FORM_MAX_FIELDS} entries`);
  }
  const names = new Set<string>();
  fields.forEach((field, index) => {
    const fieldPath = `${path}.fields[${index}]`;
    const fieldRecord = assertRecord(field, fieldPath);
    assertKnownKeys(fieldRecord, ["name", "label", "type", "options", "maxLength"], fieldPath);
    const name = requireString(fieldRecord, "name", fieldPath);
    if (!ACTION_FORM_FIELD_NAME_PATTERN.test(name)) {
      throw new Error(`${fieldPath}.name is invalid`);
    }
    if (names.has(name)) {
      throw new Error(`${fieldPath}.name is a duplicate: ${name}`);
    }
    names.add(name);
    const label = requireString(fieldRecord, "label", fieldPath);
    if (label.length < 1 || label.length > 80) {
      throw new Error(`${fieldPath}.label must be 1-80 characters`);
    }
    const type = requireString(fieldRecord, "type", fieldPath);
    if (!ACTION_FORM_FIELD_TYPES.includes(type as (typeof ACTION_FORM_FIELD_TYPES)[number])) {
      throw new Error(`${fieldPath}.type must be text, number, or select`);
    }
    if (type === "select") {
      const options = requireArray(fieldRecord.options, `${fieldPath}.options`);
      if (options.length < 1 || options.length > ACTION_FORM_MAX_OPTIONS) {
        throw new Error(
          `${fieldPath}.options must contain 1 to ${ACTION_FORM_MAX_OPTIONS} entries`,
        );
      }
      options.forEach((option, optionIndex) => {
        if (typeof option !== "string" || option.length < 1 || option.length > 80) {
          throw new Error(`${fieldPath}.options[${optionIndex}] must be a 1-80 character string`);
        }
      });
    } else if (fieldRecord.options !== undefined) {
      throw new Error(`${fieldPath}.options is only allowed for select fields`);
    }
    if (fieldRecord.maxLength !== undefined) {
      assertIntegerRange(
        fieldRecord.maxLength,
        `${fieldPath}.maxLength`,
        1,
        ACTION_FORM_MAX_FIELD_MAX_LENGTH,
      );
    }
  });
  if (record.buttonLabel !== undefined) {
    const buttonLabel = requireString(record, "buttonLabel", path);
    if (buttonLabel.length < 1 || buttonLabel.length > 40) {
      throw new Error(`${path}.buttonLabel must be 1-40 characters`);
    }
  }
  for (const match of template.matchAll(ACTION_FORM_SLOT_PATTERN)) {
    const slot = match[1]!;
    if (!names.has(slot)) {
      throw new Error(`${path}.template references unknown field: {${slot}}`);
    }
  }
  // `mode` (SPEC §17 v2): the default (absent) is `prompt` — a form that sends its
  // interpolated template to the agent (byte-identical to pre-M5 behavior). `tool`
  // mode submits the form's fields as arguments to a granted external tool; the
  // tool-only keys are inert (rejected) outside tool mode so a prompt-mode form
  // never carries dangling connector wiring. Invocation itself lands with #44.
  const mode = optionalString(record, "mode", path);
  if (mode !== undefined && mode !== "prompt" && mode !== "tool") {
    throw new Error(`${path}.mode must be "prompt" or "tool"`);
  }
  if (mode === "tool") {
    const connector = requireString(record, "connector", path);
    if (!CONNECTOR_NAME_PATTERN.test(connector)) {
      throw new Error(`${path}.connector is invalid`);
    }
    const tool = requireString(record, "tool", path);
    if (!CONNECTOR_TOOL_PATTERN.test(tool)) {
      throw new Error(`${path}.tool is invalid`);
    }
    // `argsFrom` maps a tool ARGUMENT name → a declared FIELD name; every target
    // must be a declared field (the same "no undeclared value" discipline the
    // template-slot check enforces).
    if (record.argsFrom !== undefined) {
      const argsFrom = assertRecord(record.argsFrom, `${path}.argsFrom`);
      const mappings = Object.entries(argsFrom);
      if (mappings.length > ACTION_FORM_MAX_FIELDS) {
        throw new Error(`${path}.argsFrom must contain at most ${ACTION_FORM_MAX_FIELDS} entries`);
      }
      for (const [argName, fieldName] of mappings) {
        if (!ACTION_FORM_FIELD_NAME_PATTERN.test(argName)) {
          throw new Error(`${path}.argsFrom key is invalid: ${argName}`);
        }
        if (typeof fieldName !== "string" || !names.has(fieldName)) {
          throw new Error(`${path}.argsFrom references unknown field: ${String(fieldName)}`);
        }
      }
    }
  } else {
    for (const key of ["connector", "tool", "argsFrom"] as const) {
      if (record[key] !== undefined) {
        throw new Error(`${path}.${key} is only allowed when mode is "tool"`);
      }
    }
  }
}

/**
 * Write-time validation for a `builtin:action-button` widget's props (SPEC §17 v2):
 * a one-click invocation of a granted external tool with fixed `args`. Shape-only —
 * the actual (server-gated) invocation + pending-action parking land with #44/#41.
 */
function validateActionButtonProps(value: unknown, path: string): void {
  const record = assertRecord(value, path);
  assertKnownKeys(record, ["connector", "tool", "args", "label"], path);
  const connector = requireString(record, "connector", path);
  if (!CONNECTOR_NAME_PATTERN.test(connector)) {
    throw new Error(`${path}.connector is invalid`);
  }
  const tool = requireString(record, "tool", path);
  if (!CONNECTOR_TOOL_PATTERN.test(tool)) {
    throw new Error(`${path}.tool is invalid`);
  }
  validateArgsObject(record.args, `${path}.args`);
  const label = optionalString(record, "label", path);
  if (label !== undefined && (label.length < 1 || label.length > 40)) {
    throw new Error(`${path}.label must be 1-40 characters`);
  }
}

function validateWidget(value: unknown, path: string): DashboardWidget {
  const record = assertRecord(value, path);
  assertKnownKeys(
    record,
    ["id", "kind", "title", "grid", "collapsed", "hidden", "bindings", "props", "ephemeral"],
    path,
  );
  const id = requireString(record, "id", path);
  if (!WIDGET_ID_PATTERN.test(id)) {
    throw new Error(`${path}.id is invalid`);
  }
  const kind = requireString(record, "kind", path);
  if (!BUILTIN_KIND_PATTERN.test(kind) && !CUSTOM_KIND_PATTERN.test(kind)) {
    throw new Error(`${path}.kind is invalid`);
  }
  const title = optionalString(record, "title", path);
  if (title !== undefined && title.length > 80) {
    throw new Error(`${path}.title must be 80 characters or fewer`);
  }
  const bindings =
    record.bindings === undefined
      ? undefined
      : validateBindingRecord(record.bindings, `${path}.bindings`);
  const props =
    record.props === undefined ? undefined : assertJsonValue(record.props, `${path}.props`);
  const ephemeral =
    record.ephemeral === undefined
      ? undefined
      : validateEphemeral(record.ephemeral, `${path}.ephemeral`);
  if (kind === "builtin:action-form") {
    validateActionFormProps(props, `${path}.props`);
  }
  if (kind === "builtin:action-button") {
    validateActionButtonProps(props, `${path}.props`);
  }
  return {
    id,
    kind,
    ...(title !== undefined ? { title } : {}),
    grid: validateGrid(record.grid, `${path}.grid`),
    collapsed: requireBoolean(record, "collapsed", path),
    hidden: requireBoolean(record, "hidden", path),
    ...(bindings !== undefined ? { bindings } : {}),
    ...(props !== undefined ? { props } : {}),
    ...(ephemeral !== undefined ? { ephemeral } : {}),
  };
}

function validateTabLayout(value: unknown, path: string): DashboardTabLayout | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value !== "grid" && value !== "full") {
    throw new Error(`${path}.layout must be "grid" or "full"`);
  }
  return value;
}

function validateVisibility(value: unknown, path: string): DashboardTabVisibility | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !TAB_VISIBILITY_VALUES.has(value as DashboardTabVisibility)) {
    throw new Error(`${path}.visibility must be "shared" or "private"`);
  }
  return value as DashboardTabVisibility;
}

function validateTab(value: unknown, path: string): DashboardTab {
  const record = assertRecord(value, path);
  assertKnownKeys(
    record,
    ["slug", "title", "icon", "hidden", "layout", "createdBy", "visibility", "owner", "widgets"],
    path,
  );
  const slug = requireString(record, "slug", path);
  if (!TAB_SLUG_PATTERN.test(slug)) {
    throw new Error(`${path}.slug is invalid`);
  }
  const title = requireString(record, "title", path);
  if (title.length < 1 || title.length > 80) {
    throw new Error(`${path}.title must be 1-80 characters`);
  }
  const icon = optionalString(record, "icon", path);
  if (icon !== undefined && icon.length > 40) {
    throw new Error(`${path}.icon must be 40 characters or fewer`);
  }
  const layout = validateTabLayout(record.layout, path);
  // Persist `visibility` only when `private`; `shared` is the omitted default.
  const visibility = validateVisibility(record.visibility, path);
  const owner = optionalString(record, "owner", path);
  if (owner !== undefined && !TAB_OWNER_PATTERN.test(owner)) {
    throw new Error(`${path}.owner is invalid`);
  }
  // A `private` tab is meaningless without an owner to scope its read-path
  // visibility to (SPEC §3: owner is REQUIRED when private).
  if (visibility === "private" && owner === undefined) {
    throw new Error(`${path}.owner is required when the tab is private`);
  }
  const widgets = requireArray(record.widgets, `${path}.widgets`);
  if (widgets.length > 24) {
    throw new Error(`${path}.widgets must contain at most 24 entries`);
  }
  return {
    slug,
    title,
    ...(icon !== undefined ? { icon } : {}),
    hidden: requireBoolean(record, "hidden", path),
    ...(layout !== undefined ? { layout } : {}),
    createdBy: validateActor(record.createdBy, `${path}.createdBy`),
    ...(visibility === "private" ? { visibility } : {}),
    ...(owner !== undefined ? { owner } : {}),
    widgets: widgets.map((widget, index) => validateWidget(widget, `${path}.widgets[${index}]`)),
  };
}

function validateRegistryEntry(value: unknown, path: string): DashboardWidgetRegistryEntry {
  const record = assertRecord(value, path);
  assertKnownKeys(record, ["status", "createdBy", "approvedBy", "approvedAt"], path);
  const status = requireString(record, "status", path);
  if (status !== "pending" && status !== "approved" && status !== "rejected") {
    throw new Error(`${path}.status is invalid`);
  }
  const approvedBy =
    record.approvedBy === undefined
      ? undefined
      : validateActor(record.approvedBy, `${path}.approvedBy`);
  const approvedAt = optionalString(record, "approvedAt", path);
  return {
    status,
    createdBy: validateActor(record.createdBy, `${path}.createdBy`),
    ...(approvedBy !== undefined ? { approvedBy } : {}),
    ...(approvedAt !== undefined ? { approvedAt } : {}),
  };
}

function validateWidgetsRegistry(value: unknown): Record<string, DashboardWidgetRegistryEntry> {
  const record = assertRecord(value, "widgetsRegistry");
  const registry: Record<string, DashboardWidgetRegistryEntry> = {};
  for (const [name, entry] of Object.entries(record)) {
    if (!CUSTOM_WIDGET_NAME_PATTERN.test(name)) {
      throw new Error(`widgetsRegistry.${name} name is invalid`);
    }
    registry[name] = validateRegistryEntry(entry, `widgetsRegistry.${name}`);
  }
  return registry;
}

const CAPABILITY_STATUSES = new Set<DashboardCapabilityStatus>(["requested", "granted", "revoked"]);

function validateCapabilityGrant(value: unknown, path: string): DashboardCapabilityGrant {
  const record = assertRecord(value, path);
  assertKnownKeys(
    record,
    [
      "status",
      "methods",
      "streams",
      "tools",
      "toolsHash",
      "autoConfirm",
      "expiresAt",
      "agents",
      "description",
      "grantedBy",
      "grantedAt",
    ],
    path,
  );
  const status = record.status;
  if (typeof status !== "string" || !CAPABILITY_STATUSES.has(status as DashboardCapabilityStatus)) {
    throw new Error(`${path}.status must be requested, granted, or revoked`);
  }
  // methods/streams stay REQUIRED, exactly as pre-§17 (a doc omitting them was
  // rejected then and must stay rejected — invariant #7). A tools-only grant
  // declares them as explicit empty arrays; `.length` consumers rely on that.
  const methods = allowlistArray(
    record.methods,
    `${path}.methods`,
    DATA_READ_RPC_ALLOWLIST,
    "allowlisted read method",
  );
  const streams = allowlistArray(
    record.streams,
    `${path}.streams`,
    STREAM_EVENT_ALLOWLIST,
    "allowlisted stream channel",
  );
  // `tools` (SPEC §17 v2): namespaced `connector:tool` ids, shape-validated ONLY
  // (never against DATA_READ_RPC_ALLOWLIST — the tool space is per-connector +
  // dynamic). Omitted when absent so a pre-§17 grant stays byte-identical.
  const tools =
    record.tools === undefined
      ? undefined
      : requireArray(record.tools, `${path}.tools`).map((tool, index) => {
          if (
            typeof tool !== "string" ||
            tool.length > GRANT_TOOL_ID_MAX_LENGTH ||
            !GRANT_TOOL_ID_PATTERN.test(tool)
          ) {
            throw new Error(`${path}.tools[${index}] is not a valid connector:tool id`);
          }
          return tool;
        });
  // A grant's tools are a SET — duplicates are rejected, not silently collapsed. A
  // repeated id would let a same-length surface swap slip past the store's re-pend
  // set-comparison (defense in depth with sameStringSet); forbidding it here keeps
  // the persisted grant in canonical form.
  if (tools !== undefined && new Set(tools).size !== tools.length) {
    throw new Error(`${path}.tools contains duplicate tool ids`);
  }
  const toolsHash = optionalString(record, "toolsHash", path);
  if (toolsHash !== undefined && !TOOLS_HASH_PATTERN.test(toolsHash)) {
    throw new Error(`${path}.toolsHash is invalid`);
  }
  // `autoConfirm` (SPEC §17.2, #62): the operator-set "always allow" SUBSET of the
  // grant's `tools`. Shape-validated like tool ids, then constrained to the grant's own
  // tool set — an id outside `tools` (an ungranted tool auto-running) is rejected, as
  // are duplicates (canonical form; defends the store's set-comparison re-pend gates).
  const autoConfirm =
    record.autoConfirm === undefined
      ? undefined
      : requireArray(record.autoConfirm, `${path}.autoConfirm`).map((entry, index) => {
          if (
            typeof entry !== "string" ||
            entry.length > GRANT_TOOL_ID_MAX_LENGTH ||
            !GRANT_TOOL_ID_PATTERN.test(entry)
          ) {
            throw new Error(`${path}.autoConfirm[${index}] is not a valid connector:tool id`);
          }
          return entry;
        });
  if (autoConfirm !== undefined) {
    if (new Set(autoConfirm).size !== autoConfirm.length) {
      throw new Error(`${path}.autoConfirm contains duplicate tool ids`);
    }
    const granted = new Set(tools ?? []);
    for (const id of autoConfirm) {
      if (!granted.has(id)) {
        throw new Error(`${path}.autoConfirm[${id}] is not one of the grant's tools`);
      }
    }
  }
  // `expiresAt` (SPEC §17, #64): an ISO-8601 instant. The shape guard accepts ANY valid
  // instant (past included) — future-dating is a WRITE-TIME check the approve verb owns,
  // and a granted grant that just lapsed must still validate until the sweep flips it.
  const expiresAt = optionalString(record, "expiresAt", path);
  if (
    expiresAt !== undefined &&
    (!ISO_TIMESTAMP_PATTERN.test(expiresAt) || Number.isNaN(Date.parse(expiresAt)))
  ) {
    throw new Error(`${path}.expiresAt must be an ISO 8601 timestamp`);
  }
  // `agents` (SPEC §17.3, #59): the per-agent scope. Each entry an agent actor
  // (`agent:<id>` — never user/system); shape-validated, de-duplicated, and REQUIRED to be
  // non-empty when present (absent already expresses "all agents", so an empty list would
  // be an ambiguous footgun that silently locks everyone out — reject it). Omitted on
  // output when absent so a pre-§17.3 grant stays byte-identical.
  const agents =
    record.agents === undefined
      ? undefined
      : requireArray(record.agents, `${path}.agents`).map((entry, index) => {
          if (typeof entry !== "string" || !AGENT_ACTOR_PATTERN.test(entry)) {
            throw new Error(`${path}.agents[${index}] is not a valid agent actor`);
          }
          return entry;
        });
  if (agents !== undefined) {
    if (agents.length === 0) {
      throw new Error(`${path}.agents must be a non-empty array (omit it to allow all agents)`);
    }
    if (new Set(agents).size !== agents.length) {
      throw new Error(`${path}.agents contains duplicate actors`);
    }
  }
  const description = optionalString(record, "description", path);
  if (description !== undefined && description.length > 200) {
    throw new Error(`${path}.description must be 200 characters or fewer`);
  }
  const grantedBy =
    record.grantedBy === undefined
      ? undefined
      : validateActor(record.grantedBy, `${path}.grantedBy`);
  const grantedAt = optionalString(record, "grantedAt", path);
  return {
    status: status as DashboardCapabilityStatus,
    methods,
    streams,
    ...(tools !== undefined ? { tools } : {}),
    ...(toolsHash !== undefined ? { toolsHash } : {}),
    ...(autoConfirm !== undefined ? { autoConfirm } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(agents !== undefined ? { agents } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(grantedBy !== undefined ? { grantedBy } : {}),
    ...(grantedAt !== undefined ? { grantedAt } : {}),
  };
}

/**
 * A REQUIRED array of allowlisted string entries. Shared by a grant's
 * `methods`/`streams`; an absent key rejects, exactly as pre-§17 (invariant #7 —
 * verdicts on old shapes never change). Tools-only grants pass explicit [].
 */
function allowlistArray(
  value: unknown,
  path: string,
  allowlist: readonly string[],
  label: string,
): string[] {
  return requireArray(value, path).map((entry, index) => {
    if (typeof entry !== "string" || !allowlist.includes(entry)) {
      throw new Error(`${path}[${index}] is not an ${label}`);
    }
    return entry;
  });
}

function validateCapabilitiesRegistry(value: unknown): Record<string, DashboardCapabilityGrant> {
  if (value === undefined) {
    return {}; // Optional key — pre-§17 docs simply have no grants.
  }
  const record = assertRecord(value, "capabilitiesRegistry");
  const registry: Record<string, DashboardCapabilityGrant> = {};
  for (const [name, entry] of Object.entries(record)) {
    if (!CONNECTOR_NAME_PATTERN.test(name)) {
      throw new Error(`capabilitiesRegistry.${name} connector name is invalid`);
    }
    registry[name] = validateCapabilityGrant(entry, `capabilitiesRegistry.${name}`);
  }
  return registry;
}

const PENDING_ACTION_STATUSES = new Set<PendingActionStatus>([
  "pending",
  "confirmed",
  "denied",
  "expired",
]);

/**
 * Shape guard for a persisted pending-action record (SPEC §18). Validates the type
 * the M5b-3 engine (#41) stores; this module owns no lifecycle. Throws on any
 * malformed field so a networked confirm path can trust a loaded record's shape.
 */
export function validatePendingAction(value: unknown): PendingActionRecord {
  const record = assertRecord(value, "pendingAction");
  assertKnownKeys(
    record,
    ["id", "connector", "tool", "args", "requestedBy", "createdAt", "expiresAt", "status"],
    "pendingAction",
  );
  const id = requireString(record, "id", "pendingAction");
  if (!PENDING_ACTION_ID_PATTERN.test(id)) {
    throw new Error("pendingAction.id is invalid");
  }
  const connector = requireString(record, "connector", "pendingAction");
  if (!CONNECTOR_NAME_PATTERN.test(connector)) {
    throw new Error("pendingAction.connector is invalid");
  }
  const tool = requireString(record, "tool", "pendingAction");
  if (!CONNECTOR_TOOL_PATTERN.test(tool)) {
    throw new Error("pendingAction.tool is invalid");
  }
  if (record.args === undefined) {
    throw new Error("pendingAction.args is required");
  }
  const args = validateArgsObject(record.args, "pendingAction.args")!;
  const requestedBy =
    record.requestedBy === undefined
      ? undefined
      : validateActor(record.requestedBy, "pendingAction.requestedBy");
  const createdAt = requireString(record, "createdAt", "pendingAction");
  if (!ISO_TIMESTAMP_PATTERN.test(createdAt) || Number.isNaN(Date.parse(createdAt))) {
    throw new Error("pendingAction.createdAt must be an ISO 8601 timestamp");
  }
  const expiresAt = requireString(record, "expiresAt", "pendingAction");
  if (!ISO_TIMESTAMP_PATTERN.test(expiresAt) || Number.isNaN(Date.parse(expiresAt))) {
    throw new Error("pendingAction.expiresAt must be an ISO 8601 timestamp");
  }
  const status = record.status;
  if (typeof status !== "string" || !PENDING_ACTION_STATUSES.has(status as PendingActionStatus)) {
    throw new Error("pendingAction.status must be pending, confirmed, denied, or expired");
  }
  return {
    id,
    connector,
    tool,
    args,
    ...(requestedBy !== undefined ? { requestedBy } : {}),
    createdAt,
    expiresAt,
    status: status as PendingActionStatus,
  };
}

function validatePrefs(value: unknown, tabSlugs: Set<string>): WorkspaceDoc["prefs"] {
  const record = assertRecord(value, "prefs");
  assertKnownKeys(record, ["tabOrder"], "prefs");
  const tabOrder = requireArray(record.tabOrder, "prefs.tabOrder");
  const seen = new Set<string>();
  const order = tabOrder.map((entry, index) => {
    if (typeof entry !== "string" || !TAB_SLUG_PATTERN.test(entry)) {
      throw new Error(`prefs.tabOrder[${index}] is invalid`);
    }
    if (!tabSlugs.has(entry)) {
      throw new Error(`prefs.tabOrder[${index}] is not a tab slug`);
    }
    if (seen.has(entry)) {
      throw new Error(`prefs.tabOrder contains duplicate slug: ${entry}`);
    }
    seen.add(entry);
    return entry;
  });
  return { tabOrder: order };
}

function assertUniqueTabs(tabs: DashboardTab[]): Set<string> {
  const slugs = new Set<string>();
  for (const tab of tabs) {
    if (slugs.has(tab.slug)) {
      throw new Error(`duplicate tab slug: ${tab.slug}`);
    }
    slugs.add(tab.slug);
  }
  return slugs;
}

function assertUniqueWidgets(tabs: DashboardTab[]): void {
  const ids = new Set<string>();
  for (const tab of tabs) {
    for (const widget of tab.widgets) {
      if (ids.has(widget.id)) {
        throw new Error(`duplicate widget id: ${widget.id}`);
      }
      ids.add(widget.id);
    }
  }
}

export function validateWorkspaceDoc(value: unknown): WorkspaceDoc {
  const record = assertRecord(value, "workspace");
  assertKnownKeys(
    record,
    [
      "schemaVersion",
      "workspaceVersion",
      "tabs",
      "widgetsRegistry",
      "capabilitiesRegistry",
      "prefs",
    ],
    "workspace",
  );
  if (record.schemaVersion !== CURRENT_WORKSPACE_SCHEMA_VERSION) {
    throw new Error(`schemaVersion must be ${CURRENT_WORKSPACE_SCHEMA_VERSION}`);
  }
  const workspaceVersion = assertIntegerRange(
    record.workspaceVersion,
    "workspaceVersion",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const rawTabs = requireArray(record.tabs, "tabs");
  if (rawTabs.length > 32) {
    throw new Error("tabs must contain at most 32 entries");
  }
  const tabs = rawTabs.map((tab, index) => validateTab(tab, `tabs[${index}]`));
  const tabSlugs = assertUniqueTabs(tabs);
  assertUniqueWidgets(tabs);
  return {
    schemaVersion: CURRENT_WORKSPACE_SCHEMA_VERSION,
    workspaceVersion,
    tabs,
    widgetsRegistry: validateWidgetsRegistry(record.widgetsRegistry),
    capabilitiesRegistry: validateCapabilitiesRegistry(record.capabilitiesRegistry),
    prefs: validatePrefs(record.prefs, tabSlugs),
  };
}

export function migrateWorkspaceDoc(value: unknown): { doc: WorkspaceDoc; changed: boolean } {
  const record = assertRecord(value, "workspace");
  const schemaVersion = record.schemaVersion;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    throw new Error("schemaVersion must be an integer");
  }
  if (schemaVersion > CURRENT_WORKSPACE_SCHEMA_VERSION) {
    throw new Error(`unsupported future workspace schemaVersion: ${schemaVersion}`);
  }
  if (schemaVersion < CURRENT_WORKSPACE_SCHEMA_VERSION) {
    throw new Error(`unsupported old workspace schemaVersion: ${schemaVersion}`);
  }
  return { doc: validateWorkspaceDoc(record), changed: false };
}
