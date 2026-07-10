---
"@boardstate/broker": minor
---

feat(broker): first-party connector presets — OfficeCLI + Pipedream + Composio (M5e + M5f-1)

Named recipes that stamp out a validated operator `ConnectorConfig`: `officeCliPreset`
(stdio `officecli mcp`, the first blessed first-party connector, #46), `pipedreamPreset`
and `composioPreset` (remote Streamable-HTTP aggregators behind env-ref headers, #47), a
`CONNECTOR_PRESETS` catalog, and a node-side `detectBinary` (PATH scan, spawns nothing).

Presets are a convenience, never an authority — config authorship (SPEC §18) is untouched:
a preset's output is just another entry an operator drops into the startup config, routed
through the broker's own config validator so it can never emit a connector the broker would
reject. Secrets stay env REFS (`${ENV_NAME}` header refs / stdio `env` refs), never
literals — a preset config and any board JSON are safe to share publicly. Remote aggregator
recipes are config-only, so their 2026 auth cutovers never touch code.
