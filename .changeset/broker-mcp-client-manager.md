---
"@boardstate/broker": minor
---

New package `@boardstate/broker` — the MCP CLIENT manager (M5a-1, epic #37). It connects
outward to the external MCP servers an operator declares in a `boardstate.connectors.json`
config, discovers their tools into a namespaced `ToolManifest`, and calls them behind a
narrow API the host/server layers consume.

- **Config is operator-authored only**: `loadConnectorsConfig(path)` + a programmatic
  `new McpBroker(config)`. A connector name not in the config is inert. `env` values are
  process-env var NAMES (references), never literal secrets — validated up front and never
  echoed into errors or logs.
- **Transports**: `StdioClientTransport` for local servers, `StreamableHTTPClientTransport`
  with SSE fallback for remotes. Lazy connect on first use, warm/pooled clients, capped
  exponential-backoff reconnect, clean close.
- **`listTools()` → `ToolManifest`**: `connector:tool` ids AND provider-safe
  `connector__tool` names (both inside a 64-char budget, collisions fail loud), input
  schemas, `readOnlyHint` honored (absent ⇒ treated as a mutation — fail-safe), and a
  stable manifest hash over sorted (id + canonical input-schema) pairs — the anti-rug-pull
  snapshot the grant lifecycle (M5b-2) pins to.
- **`callTool(id, args, { timeout })`**: resolves the client, strips the namespace,
  enforces a hard timeout, and normalizes `isError: true` results into a typed
  `BrokerToolError`.

Depends only on `@modelcontextprotocol/sdk` and `@boardstate/server` (types only). Ships
an in-repo fake MCP server fixture (stdio child + in-process HTTP) so CI needs no network.
