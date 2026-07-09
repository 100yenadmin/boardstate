#!/bin/bash
# MCP end-to-end regression: a REAL agent session (claude -p by default; run via
# ~/.claude/scripts/glm-p wrapper for GLM) drives the boardstate MCP server over
# stdio against a temp state dir; we assert the resulting workspace document.
# Usage: examples/mcp-regression.sh [claude-binary]  (default: claude)
set -euo pipefail
CLAUDE_BIN="${1:-claude}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="$(mktemp -d /tmp/boardstate-mcp-reg.XXXXXX)"
MCP_CONFIG="$STATE_DIR/mcp.json"
cat > "$MCP_CONFIG" <<JSON
{"mcpServers":{"boardstate":{"command":"node","args":["$REPO/packages/mcp/dist/cli.js","--state-dir","$STATE_DIR"]}}}
JSON

timeout 360 "$CLAUDE_BIN" -p "You are connected to a Boardstate dashboard via boardstate_* MCP tools. Read the board (boardstate_workspace_get), create a tab 'Regression' (slug 'regression'), then add exactly three widgets one at a time: a stat card (props: value 7, format 'plain', label 'Checks'), an area chart (props type 'area', bindings value static [1,2,3,5,8]), and a markdown note. Use exact shapes; reply DONE when finished." \
  --mcp-config "$MCP_CONFIG" --allowedTools "mcp__boardstate__*" --model sonnet > "$STATE_DIR/run.log" 2>&1 || { echo "agent run failed"; tail -5 "$STATE_DIR/run.log"; exit 1; }

node --input-type=module -e "
import { readFileSync } from 'node:fs';
const m = await import('$REPO/packages/schema/dist/index.js');
const doc = JSON.parse(readFileSync('$STATE_DIR/dashboard/workspace.json', 'utf8'));
m.validateWorkspaceDoc(doc);
const tab = doc.tabs.find((t) => t.slug === 'regression');
if (!tab) { console.log('FAIL: no regression tab'); process.exit(1); }
if (tab.widgets.length < 3) { console.log('FAIL: widgets=' + tab.widgets.length); process.exit(1); }
console.log('MCP REGRESSION PASS — tab present, widgets=' + tab.widgets.length + ', doc valid');
"
rm -rf "$STATE_DIR"
