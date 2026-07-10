// First-party connector PRESETS (epic #37, M5e/#46 + M5f-1/#47). A preset is a named,
// reviewed recipe that stamps out a valid operator `ConnectorConfig` (config.ts) — the
// boilerplate for a blessed integration, minus the operator's own choices (connector
// name, a remote endpoint). Presets are a CONVENIENCE, never an authority: a preset's
// `build()` result is just another entry an operator drops into `boardstate.connectors.json`,
// so config authorship (epic invariant #8 / SPEC §18) is untouched — a connector still
// exists ONLY because the operator named it in the startup config.
//
// Every preset's `build()` runs its output back through `parseConnectorsConfig`, so a
// preset can never emit a connector the broker would reject. Secrets stay env REFS
// (SPEC §18 / invariant #4): a preset places `${ENV_NAME}` header references or stdio
// `env` refs, never a literal token — the recipe (and any board JSON) is safe to commit
// and safe to share publicly.
//
// This module is node-side (like the rest of the broker): `detectBinary` reads the
// filesystem/`PATH`. It bundles nothing — a stdio preset points at a binary the operator
// installs; a remote preset points at a URL the operator supplies.

import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { ConnectorConfig, ConnectorTransport } from "./config.js";
import { parseConnectorsConfig } from "./config.js";

/** How a caller may tailor a preset when stamping out its connector config. */
export type ConnectorPresetBuildOptions = {
  /** Override the connector name (namespace prefix). Defaults to the preset id. */
  name?: string;
  /**
   * Remote presets: override the endpoint URL. Aggregator endpoints are per-user /
   * per-project and had 2026 auth cutovers, so the operator supplies the live URL
   * (re-verified at setup time); the preset only fills in the standard headers.
   */
  url?: string;
};

/** A binary a stdio preset needs on `PATH`, plus where to get it when it's absent. */
export type ConnectorPresetBinary = {
  /** The executable name the preset spawns (what `detectBinary` looks for). */
  command: string;
  /** A human install pointer surfaced when the binary is missing (never auto-installed). */
  install: string;
};

/** A named, reviewed connector recipe. `build()` returns a validated `ConnectorConfig`. */
export type ConnectorPreset = {
  /** Stable preset id — also the default connector name. */
  id: string;
  /** Short human title for a catalog/UI. */
  title: string;
  transport: ConnectorTransport;
  /** One-line summary of what the connector reaches. */
  summary: string;
  /** Relative path to this preset's docs page (repo-root relative). */
  docs: string;
  /** stdio presets: the binary to detect + its install pointer. Absent for remote presets. */
  requiresBinary?: ConnectorPresetBinary;
  /**
   * The process-env var NAMES this preset's config references (header `${…}` refs or
   * stdio `env` refs). Purely informational — a preflight can check they are set. The
   * VALUES never appear here (secret hygiene).
   */
  envRefs: string[];
  /** Stamp out the operator `ConnectorConfig` (validated through `parseConnectorsConfig`). */
  build(options?: ConnectorPresetBuildOptions): ConnectorConfig;
};

/** Validate a single stamped connector through the real config parser (fail-closed). */
function validated(raw: ConnectorConfig): ConnectorConfig {
  // parseConnectorsConfig is the ONE validator the broker trusts — routing a preset's
  // output through it guarantees a preset can never smuggle past config.ts's checks
  // (env-ref shape, allowed keys, transport rules).
  return parseConnectorsConfig({ connectors: [raw] }).connectors[0] as ConnectorConfig;
}

// ── OfficeCLI (#46) — the first blessed first-party connector ────────────────────────
// OfficeCLI (github.com/iOfficeAI/OfficeCLI, Apache-2.0) already ships an MCP server:
// `officecli mcp` speaks MCP over stdio. Native integration is THIS preset — no wrapper,
// no bundling. The preset pins no version: OfficeCLI moves fast, and the broker's
// manifest-hash re-pend (SPEC §17.1) absorbs tool-surface drift by design.

const OFFICECLI_COMMAND = "officecli";

/** OfficeCLI — local .xlsx/.docx/... automation over `officecli mcp` (stdio). */
export const officeCliPreset: ConnectorPreset = {
  id: "officecli",
  title: "OfficeCLI",
  transport: "stdio",
  summary: "Local office-document automation (workbooks, documents) via `officecli mcp`.",
  docs: "docs/connectors/officecli.md",
  requiresBinary: {
    command: OFFICECLI_COMMAND,
    install:
      "Install OfficeCLI (Apache-2.0) from https://github.com/iOfficeAI/OfficeCLI " +
      "(`brew install officecli` or a GitHub release) so `officecli` is on PATH.",
  },
  envRefs: [],
  build(options = {}) {
    return validated({
      name: options.name ?? this.id,
      transport: "stdio",
      command: OFFICECLI_COMMAND,
      args: ["mcp"],
    });
  },
};

// ── Pipedream MCP (#47) — remote aggregator, ~thousands of app tools ─────────────────
// A remote Streamable-HTTP MCP server. Auth is developer client-credentials OAuth; the
// broker sends STATIC (env-ref) headers, so an access token is minted out-of-band and
// placed in `PIPEDREAM_ACCESS_TOKEN` (a token-refresh sidecar is a documented manual
// step — see the docs). The per-user account mapping (`external_user_id`) lives SERVER
// side in `PIPEDREAM_EXTERNAL_USER_ID`, never in a board or a browser.

const PIPEDREAM_DEFAULT_URL = "https://remote.mcp.pipedream.net/v3/mcp";

/** Pipedream MCP — remote aggregator over Streamable HTTP + env-ref bearer/headers. */
export const pipedreamPreset: ConnectorPreset = {
  id: "pipedream",
  title: "Pipedream MCP",
  transport: "http",
  summary: "Thousands of app tools via Pipedream's remote MCP (Streamable HTTP).",
  docs: "docs/connectors/pipedream.md",
  envRefs: [
    "PIPEDREAM_ACCESS_TOKEN",
    "PIPEDREAM_PROJECT_ID",
    "PIPEDREAM_ENVIRONMENT",
    "PIPEDREAM_EXTERNAL_USER_ID",
  ],
  build(options = {}) {
    return validated({
      name: options.name ?? this.id,
      transport: "http",
      // Endpoints moved during Pipedream's 2026 cutover — re-verify at setup time.
      url: options.url ?? PIPEDREAM_DEFAULT_URL,
      headers: {
        Authorization: "Bearer ${PIPEDREAM_ACCESS_TOKEN}",
        "x-pd-project-id": "${PIPEDREAM_PROJECT_ID}",
        "x-pd-environment": "${PIPEDREAM_ENVIRONMENT}",
        // The per-user connection selector — resolved node-side, never doc/browser-visible.
        "x-pd-external-user-id": "${PIPEDREAM_EXTERNAL_USER_ID}",
      },
    });
  },
};

// ── Composio Tool Router (#47) — remote aggregator, per-user session URL ─────────────
// A remote MCP server reached at a per-user SESSION URL (minted via Composio's API) with
// an `x-api-key` (env ref). The session URL encodes the user; the operator supplies it
// as `url`. Composio's provider-side dynamic tool discovery still flows through OUR
// granted-only exposure — a discovered tool is inert until the operator grants it.

/** Composio Tool Router — remote per-user session MCP + env-ref `x-api-key`. */
export const composioPreset: ConnectorPreset = {
  id: "composio",
  title: "Composio Tool Router",
  transport: "http",
  summary: "Per-user Composio Tool Router session (remote MCP) behind an env-ref API key.",
  docs: "docs/connectors/composio.md",
  envRefs: ["COMPOSIO_API_KEY"],
  build(options = {}) {
    // No default URL: the session URL is per-user and minted at setup time (Composio's
    // `/link` migration landed 2026-07-03 — re-verify), so it MUST be supplied.
    const url = options.url;
    if (typeof url !== "string" || url.length === 0) {
      throw new Error(
        "composioPreset requires a per-user session `url` (mint it via Composio's API) — " +
          "see docs/connectors/composio.md",
      );
    }
    return validated({
      name: options.name ?? this.id,
      transport: "http",
      url,
      headers: { "x-api-key": "${COMPOSIO_API_KEY}" },
    });
  },
};

/** The first-party preset catalog, keyed by preset id. */
export const CONNECTOR_PRESETS: Readonly<Record<string, ConnectorPreset>> = Object.freeze({
  [officeCliPreset.id]: officeCliPreset,
  [pipedreamPreset.id]: pipedreamPreset,
  [composioPreset.id]: composioPreset,
});

/**
 * Detect whether a stdio preset's binary is reachable — an absolute/relative path is
 * checked directly, a bare name is resolved against `PATH` (with `PATHEXT` on Windows).
 * Node-side, read-only, spawns nothing. A stdio preset uses this to surface its
 * `requiresBinary.install` pointer BEFORE a connect attempt fails opaquely.
 */
export function detectBinary(
  command: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (command.includes("/") || command.includes("\\")) {
    return existsSync(command);
  }
  const dirs = (env.PATH ?? "").split(delimiter).filter((dir) => dir.length > 0);
  const exts =
    process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      if (existsSync(join(dir, command + ext))) {
        return true;
      }
    }
  }
  return false;
}
