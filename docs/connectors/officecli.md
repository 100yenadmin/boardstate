# OfficeCLI — the first blessed first-party connector

[OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) (Apache-2.0) automates local office
documents — workbooks, documents, slides — and **already ships an MCP server**:
`officecli mcp` speaks MCP over stdio. So the Boardstate integration is a **preset + a
grant**, not a wrapper: the broker spawns `officecli mcp`, discovers its tools, and the
operator grants the ones a board needs.

Runnable end to end: [`examples/operational-demo`](../../examples/operational-demo)
(`node examples/operational-demo/demo.mjs`, then `OFFICECLI_REAL=1 …` for the real binary).

## Install

Boardstate never bundles OfficeCLI — it points at a binary you install:

```sh
brew install officecli          # or grab a release from the GitHub project
officecli --version             # confirm it's on PATH
```

The preset detects the binary (`detectBinary("officecli")`) and surfaces a friendly
install pointer when it's absent — it never auto-installs.

## The preset

```ts
import { officeCliPreset } from "@boardstate/broker";

// Stamp an operator connector config entry (drop it into boardstate.connectors.json):
const connector = officeCliPreset.build();
// → { name: "officecli", transport: "stdio", command: "officecli", args: ["mcp"] }
```

`boardstate.connectors.json` (the operator-authored startup config — the ONLY place a
connector is defined; a name in a doc or a prompt is inert):

```json
{
  "connectors": [
    { "name": "officecli", "transport": "stdio", "command": "officecli", "args": ["mcp"] }
  ]
}
```

Build a broker + wire the M5 stack (see the demo for the full host):

```ts
import { McpBroker, loadConnectorsConfig } from "@boardstate/broker";
import { installConnectorWorkspace } from "@boardstate/server/node";

const broker = new McpBroker(await loadConnectorsConfig("boardstate.connectors.json"));
const workspace = installConnectorWorkspace(host, { broker, store });
```

No version pin: OfficeCLI moves fast, and the broker's **manifest-hash re-pend**
(SPEC §17.1) absorbs tool-surface drift by design — if a granted tool's schema changes,
the grant re-pends for re-approval before any call succeeds.

## The grant flow

1. On startup the connector's discovered tools land as a **`requested`** tool grant.
2. The operator approves them in the approvals widget
   (`dashboard.capability.approve`) — possibly a **partial subset**.
3. Granted tools are usable next turn: a `readOnly` tool as board data, a mutating tool as
   an operator-confirmed action.

An agent can drive step 1 with `boardstate_tool_search` (`mode:"search"` then
`mode:"request"`) — it asks, the operator approves.

## A worked read — workbook → table

A `source:"mcp"` binding reads a `readOnly` tool host-side and renders its value. OfficeCLI's
workbook read returns rows, so a `builtin:table` binds it directly:

```jsonc
{
  "id": "workbook",
  "kind": "builtin:table",
  "grid": { "x": 0, "y": 0, "w": 8, "h": 5 },
  "collapsed": false,
  "hidden": false,
  "bindings": {
    "value": { "source": "mcp", "connector": "officecli", "tool": "read_workbook" },
  },
  "props": { "columns": ["quarter", "region", "revenue", "deals"] },
}
```

The binding resolves via `dashboard.connector.read` (readOnly-only — it never parks), and
the table re-renders on refresh. The exact tool + argument names come from OfficeCLI's own
manifest — discover them with `boardstate_tool_search`, don't guess field names.

## A worked action — document generation → action button + confirm

A mutating tool is surfaced as a `builtin:action-button`. One click **parks** the call as a
pending action; only an **operator confirm** runs it (SPEC §18, server-enforced):

```jsonc
{
  "id": "generate",
  "kind": "builtin:action-button",
  "grid": { "x": 8, "y": 0, "w": 4, "h": 5 },
  "collapsed": false,
  "hidden": false,
  "props": {
    "connector": "officecli",
    "tool": "generate_document",
    "label": "Generate .docx",
    "args": { "title": "Quarterly Revenue Report", "format": "docx" },
  },
}
```

Over a networked transport the confirm affordance is absent — the button renders
disabled-with-reason, because a networked client is not the local operator.

## Live run (manual)

The CI proof uses the in-repo fake fixture; a **real** OfficeCLI run needs the binary and is
a documented manual step:

```sh
brew install officecli
pnpm build
OFFICECLI_REAL=1 node examples/operational-demo/demo.mjs
# open http://localhost:4700/operator → Approve the grant
# open http://localhost:4700/         → the table fills from your workbook
# click "Generate .docx" → confirm in the operator console → the .docx path renders
```

## Security

- The broker + `officecli` process are **node-side only**; browser bundles stay MCP-free.
- Tool descriptions and results are **untrusted data** — rendered inert, never
  re-interpolated into control-plane verbs.
- Every consequential action is **operator-confirmed**; a networked viewer can read granted
  data and park an action, never confirm one.
