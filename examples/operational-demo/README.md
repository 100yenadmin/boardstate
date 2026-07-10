# operational-demo — an agent-composable board that reads live data and acts

The runnable proof of the M5 **Operational Workspace** (epic
[#37](https://github.com/100yenadmin/boardstate/issues/37)): Boardstate is an MCP
**client**, connects outward to an external tool server, imports its read-ish tools as
board data and its side-effecting tools as operator-confirmed actions — all behind the
M4b capability broker.

```sh
pnpm build                                       # once, from the repo root
node examples/operational-demo/demo.mjs          # fake OfficeCLI double — no binary, no keys
OFFICECLI_REAL=1 node examples/operational-demo/demo.mjs   # drive the real `officecli mcp`
```

It prints two URLs:

- **`http://localhost:4700/`** — the **networked board**, served over the WebSocket
  transport with the default `allowOperatorMethods: false`. It renders the workbook
  through a `source:"mcp"` read binding and can **park** the "generate document" action —
  but it can never confirm it (a networked client is not the local operator).
- **`http://localhost:4700/operator`** — the **local operator console** (loopback-only).
  Approve the connector's tool grant, then confirm/deny the parked actions. These routes
  drive the in-process host directly — the true local operator.

## The loop

1. The host builds an `McpBroker` from an operator-authored connector config (the
   `officecli` connector) and wires the whole M5 stack with one call —
   `installConnectorWorkspace` (`@boardstate/server/node`).
2. The connector's tools land as a `requested` grant. **Approve it** in the operator
   console.
3. The **table** fills — its `source:"mcp"` binding reads the workbook through the
   granted `read_workbook` tool, host-side, via `dashboard.connector.read`.
4. Click **Generate .docx** on the board. `generate_document` is a _mutation_, so it
   **parks** as a pending action (visible in the operator console) instead of running.
5. **Confirm** it in the operator console → the document is generated and the result
   renders inline on the board.

## Wiring an agent (optional)

`demo.mjs` leaves the agent out so it runs with no provider key. To let a real model build
this board, add a chat agent (the reference app does exactly this):

```js
import { createAgentChatAgent } from "@boardstate/agent";
import { createChatSessions } from "@boardstate/server/node";
// host.tools() already includes boardstate_tool_search + the granted external tools.
const sessions = createChatSessions({ broadcast: host.broadcast });
const chatAgent = createAgentChatAgent({ host, provider /* anthropicAdapter(...) */ });
registerBoardstateRpc(host, {
  store,
  ...nodeRpcDeps(),
  capabilityToolsHash: workspace.capabilityToolsHash,
  chat: sessions,
  chatAgent,
});
```

The agent then `boardstate_tool_search`es the catalog, **requests** the tools it needs (a
card appears in the approvals widget), and — once the operator grants them — calls them on
its next turn. The whole loop is proven headless in
`packages/broker/src/operational-demo.e2e.test.ts`.

## Aggregator recipes

The same host reaches thousands of app tools through a remote aggregator. See
[Pipedream](../../docs/connectors/pipedream.md) and
[Composio](../../docs/connectors/composio.md), and the env-gated smokes:

```sh
node examples/operational-demo/smoke/pipedream.mjs   # skips without keys
node examples/operational-demo/smoke/composio.mjs    # skips without keys
```
