---
"@boardstate/mcp": minor
---

MCP Apps interop (SEP-1865, M4d): the live board rendered INLINE in UI-capable
hosts (Claude Desktop, VS Code Copilot, Goose).

- `ui://boardstate/board.html` — the real `<boardstate-view>` plus the ext-apps
  bridge, fully self-contained (~900 KB inlined; the host CSP is deny-by-default
  for network, matching SPEC §11-I1: the resource fetches nothing).
- `boardstate_board_view` — a readOnly tool linked via `_meta.ui.resourceUri`;
  calling it renders the board in-chat. Hosts without the UI capability get the
  workspace JSON (graceful text fallback per the spec).
- Inside the iframe, the view's transport maps `dashboard.*` onto
  `tools/call boardstate_*` — the same guarded control plane; drag & drop and
  edits flow back through the ordinary tools, and the §11-I3 approval registry
  governs custom widgets exactly as everywhere else.
- Known host caveat: some Claude connection paths still fall back to text
  (upstream issue #671) — test with a DIRECT stdio connector.
