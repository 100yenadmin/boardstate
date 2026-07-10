---
"@boardstate/server": minor
---

feat(server): one-call M5 host wiring — `installConnectorWorkspace` (M5e)

The connector broker's server-side pieces landed as separate installers with a load-bearing
ORDER; a Node host had to call four of them in the right sequence and thread three handles
into `registerBoardstateRpc` + the agent tool set. `installConnectorWorkspace`
(`@boardstate/server/node`) encodes that assembly once: it installs the pending-action
engine FIRST (it registers `dashboard.action.invoke`), then the broker→AgentTool adapter,
then the `boardstate_tool_search` backing, and returns the two seams the caller still owns
explicitly — `capabilityToolsHash` (into `registerBoardstateRpc`) and `toolSearch` (into
`createDashboardTools`). It consumes the broker through the existing narrow structural
interfaces (`ActionBroker` + `AgentToolBroker`), no `@boardstate/broker` import, so the
dependency arrow stays one-way. Additive: boards using no connector broker are unaffected.
