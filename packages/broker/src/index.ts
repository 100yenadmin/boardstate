// @boardstate/broker — the MCP CLIENT manager (epic #37, M5a-1).
//
// Public surface: build an `McpBroker` from an operator-authored connectors config
// (file via `loadConnectorsConfig`, or object via the constructor), then `listTools()`
// to discover a namespaced `ToolManifest` and `callTool()` to invoke a tool behind its
// `connector:tool` id or provider-safe `connector__tool` name.

export { McpBroker } from "./broker.js";
export type { BrokerOptions } from "./broker.js";

export { loadConnectorsConfig, parseConnectorsConfig } from "./config.js";
export type { ConnectorConfig, ConnectorsConfig, ConnectorTransport } from "./config.js";

// First-party connector presets (#46 OfficeCLI, #47 Pipedream + Composio): named
// recipes that stamp out a validated operator `ConnectorConfig`. Presets are a
// convenience, never an authority — config authorship (SPEC §18) is untouched.
export {
  CONNECTOR_PRESETS,
  composioPreset,
  detectBinary,
  officeCliPreset,
  pipedreamPreset,
} from "./presets.js";
export type {
  ConnectorPreset,
  ConnectorPresetBinary,
  ConnectorPresetBuildOptions,
} from "./presets.js";

export { buildManifest, manifestHash } from "./manifest.js";
export type {
  DiscoveredTool,
  ToolAnnotations,
  ToolManifest,
  ToolManifestEntry,
} from "./manifest.js";

export {
  buildProviderNameMap,
  manifestId,
  parseManifestId,
  toProviderName,
  MANIFEST_ID_SEPARATOR,
  NAME_BUDGET,
  PROVIDER_NAME_PATTERN,
  PROVIDER_NAME_SEPARATOR,
} from "./names.js";

export {
  BrokerBudgetError,
  BrokerConfigError,
  BrokerConnectError,
  BrokerError,
  BrokerNameCollisionError,
  BrokerTimeoutError,
  BrokerToolError,
  BrokerUnknownConnectorError,
} from "./errors.js";
