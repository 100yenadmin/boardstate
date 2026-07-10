// `installConnectorWorkspace` — the one-call host wiring for the whole M5 connector
// stack (epic #37, M5e). The M5 pieces landed as separate, independently-testable
// installers with a load-bearing ORDER and a shared broker; a host author had to call
// four of them in the right sequence and thread three handles into `registerBoardstateRpc`
// and the agent tool set. This helper encodes that assembly ONCE so a Node host wires a
// live operational workspace in a single call, then spreads the returned seams into
// `registerBoardstateRpc` + `createDashboardTools`.
//
// It consumes the broker through the SAME narrow structural interfaces the individual
// installers use (`ActionBroker` + `AgentToolBroker`) — never an `@boardstate/broker`
// import — so the dependency arrow stays one-way (broker → server) and the real
// `McpBroker` satisfies it structurally. Node-side glue; browser bundles never load it.
//
// What it installs, IN ORDER (the order matters):
//  1. `installBrokerActions` — the grant lifecycle + pending-action engine. FIRST,
//     because it registers `dashboard.action.invoke`, which the agent-tool mutation path
//     drives.
//  2. `installBrokerAgentTools` — the broker→AgentTool adapter (granted tools reach the
//     agent, mutations route through the engine installed in step 1).
//  3. `createBrokerToolSearch` — the `boardstate_tool_search` backing (search a catalog,
//     REQUEST a grant); its re-pend broadcasts on the host bus so the next turn sees it.
//
// The caller still owns `registerBoardstateRpc` (spread `capabilityToolsHash`) and the
// dashboard tool set (spread `toolSearch` into `createDashboardTools`) — this helper does
// not hide those seams, it just removes the ordering footgun.

import type { DashboardStore } from "@boardstate/core";
import type { ServerHost } from "./host.js";
import {
  installBrokerActions,
  type ActionBroker,
  type BrokerActionsHandle,
  type InstallBrokerActionsOptions,
} from "./broker-actions.js";
import {
  createBrokerToolSearch,
  installBrokerAgentTools,
  type AgentToolBroker,
  type BrokerAgentHost,
  type InstallBrokerAgentToolsHandle,
} from "./broker-agent-tools.js";
import type { ToolSearchCapability } from "./tools.js";

/** The broker surface the whole workspace needs — `McpBroker` satisfies it structurally. */
export type WorkspaceBroker = ActionBroker & AgentToolBroker;

/** The host surface `installConnectorWorkspace` drives (the in-process host satisfies it). */
export type ConnectorWorkspaceHost = ServerHost & BrokerAgentHost;

export type InstallConnectorWorkspaceOptions = {
  broker: WorkspaceBroker;
  store: DashboardStore;
  /** Pending-action TTL (ms). Default 5 minutes (SPEC §18). */
  ttlMs?: InstallBrokerActionsOptions["ttlMs"];
  /** Max `invoke`s per rolling window, per connector. Default 10. */
  invokeRateMax?: InstallBrokerActionsOptions["invokeRateMax"];
  /** Rolling rate window (ms). Default 60 000. */
  invokeRateWindowMs?: InstallBrokerActionsOptions["invokeRateWindowMs"];
  /** Clock (ms) for the pending-action engine. Injectable for deterministic tests. */
  now?: InstallBrokerActionsOptions["now"];
  /** Coarse grant-TTL sweep cadence (ms). `0` disables the timer (SPEC §17 TTLs, #64). */
  grantSweepMs?: InstallBrokerActionsOptions["grantSweepMs"];
  /** How long an agent-mediated mutation waits for the operator's confirm. Default 5 min. */
  mutationTimeoutMs?: number;
  /**
   * Async pending actions (SPEC §18 async settlement, #63). Default `false` (blocking path
   * byte-identical). When `true`, agent-invoked mutations park + return immediately, and
   * settlements are delivered via `onActionSettled`.
   */
  asyncActions?: boolean;
  /**
   * Async settlement hook (#63): invoked on every terminal transition of a parked action
   * with the settled record + result. Pair with `asyncActions: true` to deliver outcomes
   * to the chat surface / an agent wake after the turn ended.
   */
  onActionSettled?: InstallBrokerActionsOptions["onActionSettled"];
};

export type ConnectorWorkspaceHandle = {
  /** The grant lifecycle + pending-action engine (`installBrokerActions`). */
  actions: BrokerActionsHandle;
  /** The broker→AgentTool adapter wiring (`installBrokerAgentTools`). */
  agentTools: InstallBrokerAgentToolsHandle;
  /** The `boardstate_tool_search` backing — spread into `createDashboardTools({ toolSearch })`. */
  toolSearch: ToolSearchCapability;
  /** The partial-grant hash resolver — spread into `registerBoardstateRpc({ capabilityToolsHash })`. */
  capabilityToolsHash: BrokerActionsHandle["capabilityToolsHash"];
  /** Resolves once BOTH the initial grant registration and the granted-tool cache are ready. */
  ready: Promise<void>;
  /** Re-discover tools + refresh grants and the agent-tool cache (leaves `granted` grants alone). */
  refresh(): Promise<void>;
  /** Tear down the engine timers + the change-bus listener (idempotent). */
  stop(): void;
};

/**
 * Wire the broker's grant lifecycle, pending-action engine, agent-tool adapter, and
 * `boardstate_tool_search` backing onto a host in the correct order. Returns the seams
 * the caller threads into `registerBoardstateRpc` (`capabilityToolsHash`) and the
 * dashboard tool set (`toolSearch`).
 */
export function installConnectorWorkspace(
  host: ConnectorWorkspaceHost,
  options: InstallConnectorWorkspaceOptions,
): ConnectorWorkspaceHandle {
  const { broker, store } = options;

  // 1. The engine FIRST — it registers `dashboard.action.invoke`, which step 2 drives.
  const actions = installBrokerActions(host, {
    broker,
    store,
    ...(options.ttlMs !== undefined ? { ttlMs: options.ttlMs } : {}),
    ...(options.invokeRateMax !== undefined ? { invokeRateMax: options.invokeRateMax } : {}),
    ...(options.invokeRateWindowMs !== undefined
      ? { invokeRateWindowMs: options.invokeRateWindowMs }
      : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.grantSweepMs !== undefined ? { grantSweepMs: options.grantSweepMs } : {}),
    ...(options.onActionSettled !== undefined ? { onActionSettled: options.onActionSettled } : {}),
  });

  // 2. The adapter — granted readOnly tools execute directly; mutations park via the
  //    engine installed above and block on the operator's confirm.
  const agentTools = installBrokerAgentTools(host, {
    broker,
    store,
    actions,
    ...(options.mutationTimeoutMs !== undefined
      ? { mutationTimeoutMs: options.mutationTimeoutMs }
      : {}),
    ...(options.asyncActions !== undefined ? { asyncActions: options.asyncActions } : {}),
  });

  // 3. The search/request backing — a re-pend broadcasts on the host bus so the next
  //    turn's tool factory (and any networked view) sees the updated grant.
  const toolSearch = createBrokerToolSearch({
    broker,
    store,
    broadcast: (event, payload) => host.broadcast(event, payload),
  });

  return {
    actions,
    agentTools,
    toolSearch,
    capabilityToolsHash: actions.capabilityToolsHash,
    ready: Promise.all([actions.ready, agentTools.ready]).then(() => undefined),
    async refresh() {
      await actions.refreshGrants();
      await agentTools.refresh();
    },
    stop() {
      agentTools.stop();
      actions.stop();
    },
  };
}
