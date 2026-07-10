// MCP Apps interop (SEP-1865, extension `io.modelcontextprotocol/ui`; issue #26):
// the live board rendered INLINE in an MCP Apps host (Claude Desktop, VS Code, …).
//
// One resource — `ui://boardstate/board.html` — carries the REAL `<boardstate-view>`
// plus the ext-apps bridge, fully self-contained (the host CSP is deny-by-default
// for network, which matches SPEC §11-I1's posture exactly: the resource fetches
// nothing). One tool — `boardstate_board_view` — links it via `_meta.ui.resourceUri`
// so calling the tool renders the board in-chat; hosts without the UI capability
// get the same JSON summary every other tool returns (graceful text fallback).
//
// The in-iframe half (src/board-app-client.ts, bundled self-contained at build time)
// maps `dashboard.*` requests onto `tools/call boardstate_*` — the same guarded
// control plane, over the only channel the sandbox has. Approval invariants carry
// over untouched: the view renders custom widgets through the SAME pending/approved
// registry rules as everywhere else (§11-I3).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

export const BOARD_RESOURCE_URI = "ui://boardstate/board.html";
export const BOARD_TOOL_NAME = "boardstate_board_view";
/** SEP-1865's HTML UI mimeType (mirrors ext-apps' RESOURCE_MIME_TYPE). */
export const BOARD_RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

/** The ListTools descriptor for the board-view tool (low-level Server integration). */
export const BOARD_TOOL_DESCRIPTOR = {
  name: BOARD_TOOL_NAME,
  description:
    "Render the current dashboard inline as an interactive board (MCP Apps hosts) — " +
    "the same live view humans use, with drag & drop wired back through the " +
    "boardstate_* tools. Hosts without UI support receive the workspace JSON instead.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  _meta: { ui: { resourceUri: BOARD_RESOURCE_URI } },
} as const;

let cachedHtml: string | null = null;

/**
 * Build (once) the self-contained board app HTML: the boardstate styles + the
 * IIFE client bundle (ext-apps bridge + lit browser bundle + the transport adapter),
 * inlined. Resolution happens lazily at first read so merely importing this module
 * never touches the filesystem.
 */
export function boardAppHtml(): string {
  if (cachedHtml) {
    return cachedHtml;
  }
  const require = createRequire(import.meta.url);
  const styles = readFileSync(require.resolve("@boardstate/lit/styles.css"), "utf8");
  // Sibling in dist at runtime; ../dist when this module runs from src (vitest).
  let client: string | null = null;
  for (const candidate of ["./board-app-client.iife.js", "../dist/board-app-client.iife.js"]) {
    try {
      client = readFileSync(new URL(candidate, import.meta.url), "utf8");
      break;
    } catch {
      // Try the next location.
    }
  }
  if (client === null) {
    throw new Error("board-app-client bundle missing — build @boardstate/mcp first");
  }
  cachedHtml = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<style>${styles}</style>
<style>
  body { margin: 0; background: var(--bs-bg, #0b0b0f); color: var(--bs-text, #ededf2);
    font-family: -apple-system, system-ui, sans-serif; }
  #app { padding: 12px; }
</style>
</head>
<body>
<div id="app"></div>
<script>${client}</script>
</body>
</html>`;
  return cachedHtml;
}
