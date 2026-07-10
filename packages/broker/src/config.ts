// The operator-authored connectors config (epic invariant #8). Connectors exist ONLY
// because they are named in this object — a `boardstate.connectors.json` file an
// operator writes and controls. A connector name that appears in a doc, a prompt, or a
// model's output but NOT here is inert: `McpBroker` refuses to resolve it.
//
// ── env-ref semantics (load-bearing) ────────────────────────────────────────────────
// `env` values are the NAMES of process env vars, never the secret values themselves:
//
//     "env": { "SLACK_TOKEN": "OFFICE_SLACK_TOKEN" }
//
// means "forward the value of process.env.OFFICE_SLACK_TOKEN as the child's SLACK_TOKEN"
// (stdio) or "resolve process.env.OFFICE_SLACK_TOKEN when building this connector's HTTP
// headers". The config file therefore holds no secrets and is safe to commit.
//
// We validate that every env value is a syntactically valid env-var reference
// (`^[A-Za-z_][A-Za-z0-9_]*$`). This is a fail-safe, not a secret detector: a literal
// that merely LOOKS like an identifier can't be told apart from a real reference, so we
// document the contract and reject everything that is obviously not a reference (spaces,
// `-`, `.`, `/`, `=`, `+`, over-long strings — the shapes real tokens take). Resolution
// happens later, in the broker, and a resolved value is never echoed into an error/log.

import { readFile } from "node:fs/promises";
import { BrokerConfigError } from "./errors.js";

export type ConnectorTransport = "stdio" | "http";

/** One operator-declared connector. `stdio` needs `command`; `http` needs `url`. */
export type ConnectorConfig = {
  /** Short, stable namespace prefix — the `connector` half of every `connector:tool` id. */
  name: string;
  transport: ConnectorTransport;
  /** stdio: the executable to spawn (e.g. `npx`, an absolute path). */
  command?: string;
  /** stdio: argv for `command`. */
  args?: string[];
  /** http: the MCP endpoint URL (Streamable HTTP, with SSE fallback). */
  url?: string;
  /** http: static request headers. Values may embed `${ENV_NAME}` refs (resolved later). */
  headers?: Record<string, string>;
  /**
   * env-var REFERENCES, never literals. stdio: `{ CHILD_VAR: SOURCE_ENV_NAME }` forwards
   * `process.env.SOURCE_ENV_NAME` into the child as `CHILD_VAR`. http: same names are
   * available to header `${…}` interpolation.
   */
  env?: Record<string, string>;
};

export type ConnectorsConfig = {
  connectors: ConnectorConfig[];
};

/** Fields legal on a connector entry — anything else is a typo or an injection attempt. */
const ALLOWED_KEYS = new Set(["name", "transport", "command", "args", "url", "headers", "env"]);

/** A syntactically valid POSIX-ish env-var name (what an `env` value must be). */
const ENV_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Same short namespace charset the server's connector uses (connector.ts:87). */
const CONNECTOR_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate one env map: every value must be an env-var reference, not a literal secret. */
function validateEnvRefs(name: string, env: unknown): Record<string, string> {
  if (!isPlainObject(env)) {
    throw new BrokerConfigError(`connector "${name}": env must be an object of NAME->ENV_REF`);
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string" || !ENV_REF_PATTERN.test(value)) {
      // Deliberately do NOT echo `value` — if it is a mispasted secret, keep it out of logs.
      throw new BrokerConfigError(
        `connector "${name}": env["${key}"] must be a process-env var NAME ` +
          `(matching /^[A-Za-z_][A-Za-z0-9_]*$/), not a literal value`,
      );
    }
    out[key] = value;
  }
  return out;
}

/** Validate + normalize one raw connector entry into a `ConnectorConfig`. */
function parseConnector(raw: unknown, index: number): ConnectorConfig {
  if (!isPlainObject(raw)) {
    throw new BrokerConfigError(`connectors[${index}] must be an object`);
  }
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new BrokerConfigError(`connectors[${index}]: unknown field "${key}"`);
    }
  }

  const name = raw.name;
  if (typeof name !== "string" || !CONNECTOR_NAME_PATTERN.test(name)) {
    throw new BrokerConfigError(`connectors[${index}]: name must match /^[A-Za-z0-9._-]{1,64}$/`);
  }

  const transport = raw.transport;
  if (transport !== "stdio" && transport !== "http") {
    throw new BrokerConfigError(`connector "${name}": transport must be "stdio" or "http"`);
  }

  const config: ConnectorConfig = { name, transport };

  if (transport === "stdio") {
    if (typeof raw.command !== "string" || raw.command.length === 0) {
      throw new BrokerConfigError(`connector "${name}": stdio transport requires a "command"`);
    }
    config.command = raw.command;
    if (raw.args !== undefined) {
      if (!Array.isArray(raw.args) || raw.args.some((a) => typeof a !== "string")) {
        throw new BrokerConfigError(`connector "${name}": args must be an array of strings`);
      }
      config.args = raw.args as string[];
    }
    if (raw.url !== undefined) {
      throw new BrokerConfigError(`connector "${name}": "url" is not valid for a stdio transport`);
    }
  } else {
    if (typeof raw.url !== "string" || raw.url.length === 0) {
      throw new BrokerConfigError(`connector "${name}": http transport requires a "url"`);
    }
    try {
      // eslint-disable-next-line no-new
      new URL(raw.url);
    } catch {
      throw new BrokerConfigError(`connector "${name}": url "${raw.url}" is not a valid URL`);
    }
    config.url = raw.url;
    if (raw.command !== undefined || raw.args !== undefined) {
      throw new BrokerConfigError(
        `connector "${name}": "command"/"args" are not valid for an http transport`,
      );
    }
    if (raw.headers !== undefined) {
      if (
        !isPlainObject(raw.headers) ||
        Object.values(raw.headers).some((v) => typeof v !== "string")
      ) {
        throw new BrokerConfigError(`connector "${name}": headers must be a string map`);
      }
      config.headers = raw.headers as Record<string, string>;
    }
  }

  if (raw.env !== undefined) {
    config.env = validateEnvRefs(name, raw.env);
  }

  return config;
}

/**
 * Validate a raw (JSON-parsed) connectors config. Rejects unknown fields, bad
 * transports, duplicate connector names, and any `env` value that is not an env-var
 * reference. Returns a normalized {@link ConnectorsConfig}.
 */
export function parseConnectorsConfig(raw: unknown): ConnectorsConfig {
  if (!isPlainObject(raw)) {
    throw new BrokerConfigError("connectors config must be a JSON object");
  }
  for (const key of Object.keys(raw)) {
    if (key !== "connectors") {
      throw new BrokerConfigError(`unknown top-level field "${key}" (expected only "connectors")`);
    }
  }
  if (!Array.isArray(raw.connectors)) {
    throw new BrokerConfigError('config must have a "connectors" array');
  }
  const connectors = raw.connectors.map((entry, index) => parseConnector(entry, index));
  const seen = new Set<string>();
  for (const connector of connectors) {
    if (seen.has(connector.name)) {
      throw new BrokerConfigError(`duplicate connector name "${connector.name}"`);
    }
    seen.add(connector.name);
  }
  return { connectors };
}

/**
 * Load + validate an operator-authored connectors config file (`boardstate.connectors.json`).
 * Throws {@link BrokerConfigError} on a missing/malformed file or any validation failure.
 */
export async function loadConnectorsConfig(path: string): Promise<ConnectorsConfig> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new BrokerConfigError(
      `cannot read connectors config at "${path}": ${(error as Error).message}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new BrokerConfigError(
      `connectors config at "${path}" is not valid JSON: ${(error as Error).message}`,
    );
  }
  return parseConnectorsConfig(raw);
}
