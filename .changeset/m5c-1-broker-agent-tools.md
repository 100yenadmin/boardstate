---
"@boardstate/server": minor
---

feat(server): broker→AgentTool adapter + `boardstate_tool_search` (M5c-1 + M5c-2)

Granted external MCP tools now reach the agent. `createBrokerAgentTools` wraps each GRANTED
tool as an `AgentTool` (provider-safe name, untrusted-framed description, `external: true`);
`readOnly` tools execute directly through the broker while mutations route through the
server-enforced pending-action engine (park → await operator confirm), returning a
model-legible refusal on deny/timeout/expiry rather than throwing. `installBrokerAgentTools`
wires the adapter via `host.registerTool` (grant/revoke picked up next turn).

Adds the `boardstate_tool_search` core tool (SEARCH a connector's full catalog, bounded and
schema-free; REQUEST tools by appending to the connector grant's `requested` set — never
grants, re-pends a granted grant per the merged partial-grant lifecycle) with the node-side
`createBrokerToolSearch` backing. `AgentTool` gains an optional `external` marker. SPEC §18.1
and §18.2 document the agent surface and the request/approve loop.
