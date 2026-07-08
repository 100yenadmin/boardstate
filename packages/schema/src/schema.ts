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
export type DashboardBinding =
  | DashboardRpcBinding
  | DashboardFileBinding
  | DashboardStaticBinding
  | DashboardStreamBinding
  | DashboardComputedBinding;
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
export type WorkspaceDoc = {
  schemaVersion: 1;
  workspaceVersion: number;
  tabs: DashboardTab[];
  widgetsRegistry: Record<string, DashboardWidgetRegistryEntry>;
  prefs: { tabOrder: string[] };
};

export const CURRENT_WORKSPACE_SCHEMA_VERSION = 1;

const TAB_SLUG_PATTERN = /^[a-z0-9-]{1,40}$/;
const ACTOR_PATTERN = /^(user|system|agent:[A-Za-z0-9._-]{1,64})$/;
const TAB_VISIBILITY_VALUES = new Set<DashboardTabVisibility>(["shared", "private"]);
/** Bounded opaque operator-identity string (e.g. `device:<id>`). */
const TAB_OWNER_PATTERN = /^[A-Za-z0-9:._-]{1,128}$/;
const WIDGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,48}$/;
const BUILTIN_KIND_PATTERN =
  /^builtin:(stat-card|markdown|table|iframe-embed|sessions|usage|cron|instances|activity|chart|notes|action-form|preview|agent-status|approvals)$/;
const CUSTOM_KIND_PATTERN = /^custom:[A-Za-z0-9._-]{1,64}$/;
const CUSTOM_WIDGET_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
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
  return Buffer.byteLength(JSON.stringify(value), "utf8");
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
  throw new Error(`${path}.source is invalid`);
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
  assertKnownKeys(record, ["template", "fields", "buttonLabel"], path);
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
    ["schemaVersion", "workspaceVersion", "tabs", "widgetsRegistry", "prefs"],
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
