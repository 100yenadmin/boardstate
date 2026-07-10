// Template recipe format (issue #60): a workspace document distributed together with
// the human-labeled GRANTS it needs to light up — "install a board, not rebuild it".
//
// A recipe is PURE DATA (no code runs at install). It is a `doc` (a full WorkspaceDoc,
// validated by the same §3 write-time validator as every other write path) plus a
// `grantsManifest`: connector name → the external tools that board will REQUEST, each
// with a human label an operator reads BEFORE approving. Installing a recipe imports the
// doc through the existing distribution re-pend seam (`sanitizeImportedWorkspace` +
// `reconcileReplaceApproval`), so every declared grant lands `requested` and no recipe
// can ever arrive pre-granted — that invariant is enforced at the store, never here. This
// module owns only the FORMAT + its shape validation; the install transform (merging the
// manifest into the doc's `capabilitiesRegistry`) lives in `@boardstate/core`.
//
// The registry index (`templates/registry/index.json`) stays static-hostable: a recipe
// entry is `{ name, title, description, manifestUrl, connectors }`, siblings of the
// existing widget entries.

import { validateWorkspaceDoc, type WorkspaceDoc } from "./schema.js";

/** The recipe envelope version. Bumped only on a breaking format change. */
export const CURRENT_RECIPE_VERSION = 1;

// A connector name and a bounded human label share the schema's connector alphabet /
// caps. A namespaced grant-tool id is `connector:tool`, capped at 64 chars overall —
// identical to the grant record's `tools[]` ids so a manifest tool maps 1:1 to a grant.
const RECIPE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const CONNECTOR_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const GRANT_TOOL_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}:[A-Za-z0-9._-]{1,64}$/;
const GRANT_TOOL_ID_MAX_LENGTH = 64;
const RECIPE_TITLE_MAX = 80;
const RECIPE_DESCRIPTION_MAX = 280;
const GRANT_LABEL_MAX = 80;
const GRANT_REASON_MAX = 200;
const MAX_CONNECTORS = 16;
const MAX_TOOLS_PER_CONNECTOR = 32;

/** One external tool a recipe's board will request, with the label the operator reads. */
export type RecipeGrantTool = {
  /** Namespaced `connector:tool` id — matches the grant record's `tools[]` entry. */
  id: string;
  /** Human one-liner shown in the "what it needs" list before install/approve. */
  label: string;
  /** Informational: this tool only READS (a mutation is left unmarked). */
  readOnly?: boolean;
};

/**
 * The grants one connector's board asks for. `tools` are the external tools; `methods`/
 * `streams` are the allowlisted read RPCs / stream channels the connector's read bindings
 * cover (usually empty for an external-tool connector). At least one of the three must be
 * non-empty — an empty grant is meaningless.
 */
export type RecipeConnectorGrant = {
  /** Human label for the connector (e.g. "Office CLI"). */
  label: string;
  /** Why the board needs this connector — surfaced on the approval card as `description`. */
  reason?: string;
  methods?: string[];
  streams?: string[];
  tools?: RecipeGrantTool[];
};

/** Connector name → the grant it requests. */
export type RecipeGrantsManifest = Record<string, RecipeConnectorGrant>;

/** A distributable template bundle: a board + the grants it needs, as one installable. */
export type TemplateRecipe = {
  recipeVersion: number;
  /** Stable machine name (registry key + `*.recipe.json` filename stem). */
  name: string;
  /** Display title for the Templates gallery card. */
  title: string;
  /** One-paragraph preview blurb for the gallery card. */
  description: string;
  doc: WorkspaceDoc;
  grantsManifest: RecipeGrantsManifest;
};

/** One entry in the registry index's `recipes` array (static-hostable, sibling of widgets). */
export type RecipeIndexEntry = {
  name: string;
  title: string;
  description: string;
  /** Absolute/relative URL of the `*.recipe.json` bundle (resolved against the index URL). */
  manifestUrl: string;
  /** Connector names the recipe requests grants for (a quick "what it needs" hint). */
  connectors: string[];
};

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

function optionalStringArray(
  record: Record<string, unknown>,
  key: string,
  path: string,
): string[] | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${path}.${key} must be an array`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new Error(`${path}.${key}[${index}] must be a non-empty string`);
    }
    return entry;
  });
}

function validateGrantTool(value: unknown, connector: string, path: string): RecipeGrantTool {
  const record = assertRecord(value, path);
  assertKnownKeys(record, ["id", "label", "readOnly"], path);
  const id = requireString(record, "id", path);
  if (id.length > GRANT_TOOL_ID_MAX_LENGTH || !GRANT_TOOL_ID_PATTERN.test(id)) {
    throw new Error(`${path}.id is not a valid connector:tool id`);
  }
  // Keep the manifest honest: a tool listed under connector `X` must be an `X:*` id, so
  // the label the operator reads maps 1:1 to the grant tool that actually gets requested.
  if (id.slice(0, id.indexOf(":")) !== connector) {
    throw new Error(`${path}.id "${id}" must be namespaced under connector "${connector}"`);
  }
  const label = requireString(record, "label", path);
  if (label.length < 1 || label.length > GRANT_LABEL_MAX) {
    throw new Error(`${path}.label must be 1-${GRANT_LABEL_MAX} characters`);
  }
  const readOnly = record.readOnly;
  if (readOnly !== undefined && typeof readOnly !== "boolean") {
    throw new Error(`${path}.readOnly must be a boolean`);
  }
  return {
    id,
    label,
    ...(readOnly !== undefined ? { readOnly } : {}),
  };
}

function validateConnectorGrant(
  value: unknown,
  connector: string,
  path: string,
): RecipeConnectorGrant {
  const record = assertRecord(value, path);
  assertKnownKeys(record, ["label", "reason", "methods", "streams", "tools"], path);
  const label = requireString(record, "label", path);
  if (label.length < 1 || label.length > GRANT_LABEL_MAX) {
    throw new Error(`${path}.label must be 1-${GRANT_LABEL_MAX} characters`);
  }
  const reason = optionalString(record, "reason", path);
  if (reason !== undefined && reason.length > GRANT_REASON_MAX) {
    throw new Error(`${path}.reason must be ${GRANT_REASON_MAX} characters or fewer`);
  }
  const methods = optionalStringArray(record, "methods", path);
  const streams = optionalStringArray(record, "streams", path);
  let tools: RecipeGrantTool[] | undefined;
  if (record.tools !== undefined) {
    if (!Array.isArray(record.tools)) {
      throw new Error(`${path}.tools must be an array`);
    }
    if (record.tools.length > MAX_TOOLS_PER_CONNECTOR) {
      throw new Error(`${path}.tools must contain at most ${MAX_TOOLS_PER_CONNECTOR} entries`);
    }
    tools = record.tools.map((tool, index) =>
      validateGrantTool(tool, connector, `${path}.tools[${index}]`),
    );
    const ids = tools.map((tool) => tool.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error(`${path}.tools contains duplicate tool ids`);
    }
  }
  const nonEmpty =
    (methods?.length ?? 0) > 0 || (streams?.length ?? 0) > 0 || (tools?.length ?? 0) > 0;
  if (!nonEmpty) {
    throw new Error(`${path} must request at least one tool, method, or stream`);
  }
  return {
    label,
    ...(reason !== undefined ? { reason } : {}),
    ...(methods !== undefined ? { methods } : {}),
    ...(streams !== undefined ? { streams } : {}),
    ...(tools !== undefined ? { tools } : {}),
  };
}

function validateGrantsManifest(value: unknown, path: string): RecipeGrantsManifest {
  if (value === undefined) {
    return {}; // A recipe with no grants (e.g. the Agent-memory template) is valid.
  }
  const record = assertRecord(value, path);
  const names = Object.keys(record);
  if (names.length > MAX_CONNECTORS) {
    throw new Error(`${path} must reference at most ${MAX_CONNECTORS} connectors`);
  }
  const manifest: RecipeGrantsManifest = {};
  for (const [connector, entry] of Object.entries(record)) {
    if (!CONNECTOR_NAME_PATTERN.test(connector)) {
      throw new Error(`${path}.${connector} connector name is invalid`);
    }
    manifest[connector] = validateConnectorGrant(entry, connector, `${path}.${connector}`);
  }
  return manifest;
}

/**
 * Validate a template recipe (SPEC / issue #60). Throws on any malformed field so the
 * honesty gate (`pnpm build:registry` + the templates test) can trust every shipped
 * recipe. The embedded `doc` runs through the SAME `validateWorkspaceDoc` as every write
 * path — a recipe can never smuggle a doc the store would reject. This validates SHAPE;
 * the install-time re-pend (no recipe arrives pre-granted) is enforced downstream at the
 * store, not here.
 */
export function validateRecipe(value: unknown): TemplateRecipe {
  const record = assertRecord(value, "recipe");
  assertKnownKeys(
    record,
    ["recipeVersion", "name", "title", "description", "doc", "grantsManifest"],
    "recipe",
  );
  if (record.recipeVersion !== CURRENT_RECIPE_VERSION) {
    throw new Error(`recipe.recipeVersion must be ${CURRENT_RECIPE_VERSION}`);
  }
  const name = requireString(record, "name", "recipe");
  if (!RECIPE_NAME_PATTERN.test(name)) {
    throw new Error("recipe.name is invalid");
  }
  const title = requireString(record, "title", "recipe");
  if (title.length < 1 || title.length > RECIPE_TITLE_MAX) {
    throw new Error(`recipe.title must be 1-${RECIPE_TITLE_MAX} characters`);
  }
  const description = requireString(record, "description", "recipe");
  if (description.length < 1 || description.length > RECIPE_DESCRIPTION_MAX) {
    throw new Error(`recipe.description must be 1-${RECIPE_DESCRIPTION_MAX} characters`);
  }
  if (record.doc === undefined) {
    throw new Error("recipe.doc is required");
  }
  const doc = validateWorkspaceDoc(record.doc);
  const grantsManifest = validateGrantsManifest(record.grantsManifest, "recipe.grantsManifest");
  return {
    recipeVersion: CURRENT_RECIPE_VERSION,
    name,
    title,
    description,
    doc,
    grantsManifest,
  };
}

/** The connector names a recipe requests grants for (stable-sorted), for the index entry. */
export function recipeConnectors(recipe: TemplateRecipe): string[] {
  return Object.keys(recipe.grantsManifest).sort();
}
