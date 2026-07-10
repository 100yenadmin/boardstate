# Changelog

The release history of Boardstate, told by milestone. Every entry below shipped as one
[changesets](https://github.com/changesets/changesets) release train; the granular,
per-version record lives in each package's own changelog
(e.g. [`packages/server/CHANGELOG.md`](packages/server/CHANGELOG.md)), and every published
version carries npm provenance (Sigstore attestation — verifiable on each package's npm page).

Current versions: `schema@1.2.0` · `core@1.3.0` · `host@1.3.0` · `server@1.4.0` ·
`lit@0.5.0` · `react@0.1.9` · `mcp@0.2.6` · `agent@0.3.1` · `broker@0.3.0` ·
`conformance@0.1.13`.

---

## M5 — The Operational Workspace (2026-07-10 → 07-11)

Boardstate becomes an MCP **client**: point it at any external MCP tool server (OfficeCLI,
Pipedream, Composio, anything) and the board reads those tools as live data and runs them as
operator-confirmed actions — all governed by the capability broker. Shipped as three trains
(epic [#37](https://github.com/100yenadmin/boardstate/issues/37)):

### S5-3 · The product — `broker@0.3.0` · `server@1.4.0` · `agent@0.3.1` · `mcp@0.2.6`

- **Connector presets** — first-party `officeCliPreset` (OfficeCLI's built-in `officecli mcp`,
  stdio, with binary detection), plus `pipedreamPreset` and `composioPreset` for the two
  remote aggregators. Every preset routes through the broker's own config validator; auth is
  `${ENV}`-ref headers resolved node-side only.
- **One-call host wiring** — `installConnectorWorkspace` (`@boardstate/server/node`)
  assembles the whole M5 stack in the load-bearing order: pending-action engine → broker→agent
  tool adapter → `boardstate_tool_search`. Structural broker interfaces keep the dependency
  arrow one-way (broker → server, never back).
- **`examples/operational-demo`** — the runnable, keyless proof of the whole loop (a fake
  OfficeCLI double; `OFFICECLI_REAL=1` drives the real binary): approve a grant, watch a table
  fill from a live workbook, park a mutation, confirm it as the local operator. The same loop
  is asserted headless in CI against the fake-MCP fixture.
- Docs: `docs/connectors/{officecli,pipedream,composio}.md`, SPEC §18.3.

### S5-2 · The hands — `core/server/host@1.3.0` · `lit@0.5.0` · `agent@0.3.0` · `broker@0.2.1`

- **Broker tools reach the agent** — granted external tools appear in the agent's tool set
  per-turn (`installBrokerAgentTools`): `readOnly` tools execute directly; mutations route
  through the server-enforced pending-action gate. All external text (descriptions, results,
  refusals) is framed as untrusted data.
- **`boardstate_tool_search`** — the agent's discovery + request loop: SEARCH the connector
  catalog (bounded, schema-free), REQUEST tools it needs. A request can never grant — it
  re-pends the whole grant for the operator.
- **Definition-token budget** — external tool definitions are budgeted per turn
  (MRU-first, collapsed stubs stay callable), so a huge connector catalog can't blow the
  prompt. Core-only boards are byte-identical (the budget engages only when external tools
  exist).
- **`builtin:action-button`** — a governed action as a widget: click → invoke → full inline
  lifecycle (running / parked "waiting for operator" / confirmed / denied / expired), result
  rendered inert. **`action-form` `mode:"tool"`** maps declared form fields to tool args.
- **`source:"mcp"` read bindings** — widgets bind live external data through the granted
  tool, resolved host-side via the **pure-read verb** `dashboard.connector.read`, which
  refuses a non-`readOnly` tool _without_ parking (a read can never cause a side effect).

### S5-1 · The substrate — `broker@0.2.0` (new) · `schema@1.2.0` · `core/server/host@1.2.0` · `lit@0.4.0`

- **`@boardstate/broker`** — the MCP client manager: connect to operator-configured
  connectors (stdio + streamable HTTP), discover tools, `callTool`, manifest hashing.
- **SPEC §17 v2 tool grants** — per-tool grants in the capabilities registry with
  `toolsHash` anti-rug-pull in **both directions** (a server that swaps a tool's surface
  under a grant re-pends it; a re-request after grant re-pends it), partial grants
  (the operator grants a subset), and duplicate-tool-id rejection.
- **The pending-action engine** — `dashboard.action.invoke` executes `readOnly` granted
  tools directly and **parks** mutations as TTL'd pending actions;
  `dashboard.action.confirm`/`deny` are operator-only over the wire (a networked client
  physically cannot confirm). Single-shot terminal states, replay refusal, rate limiting,
  an audit trail, and `dashboard.action.changed` lifecycle events.
- The approvals widget grew a pending-action row: confirm/deny inline as the local
  operator, or a disabled-with-reason affordance otherwise.

**Hardening across the epic:** adversarial verification caught and fixed ten real defects,
including a pre-existing agent self-grant hole (the agent's `workspace.replace` bypassed
the M4b capability gate — shipped in 1.x, now regression-locked), a concurrent-confirm
double-execution race, and a read binding that parked mutations into the operator queue.

## M4 — The trusted workspace (2026-07-10)

- **M4b · Capability broker** — `schema/core/server@1.0.0`: the capabilities registry
  (`requested → granted/denied/revoked` grants over methods/streams), reconcile-on-replace
  so no document write can self-grant, and the **approvals widget** as the operator's grant
  console. The spine that M5 tool grants extend.
- **M4d · MCP Apps board view** — `boardstate_board_view` renders the live board _inside_
  an MCP client (e.g. Claude Desktop) via the MCP Apps draft spec (`mcp@0.2.x`).
- **M4c · Connector contract** — `server@0.5.0`: `installConnector` + the connector-sidecar
  example (SPEC §16) — bring external data into a running host from a sidecar process.
- **M4a · The self-building loop** — `boardstate_design_review` + `selfReview:"once"`:
  the agent screenshots and critiques the board it just built, then fixes what it finds.

## R1/R2 — Networked and documented (2026-07-10)

- **R1 · WS transport hardened** — `server@0.4.0`, `core@0.4.0`, `lit@0.2.0`: the
  production WebSocket transport (`attachWsTransport` + `createWsTransport`), with
  `OPERATOR_ONLY_METHODS` enforcement, default-forward event streams, and origin checks.
- **R2 · Widget catalog** — `boardstate_widget_catalog` (schema-valid examples for every
  builtin, honesty-gated in CI) and corrected agent guides; fixed an always-broken
  `boardstate_widget_update` and silent string-prop degradation, both caught live.

## M1–M3 — The agent layer (2026-07-10)

- **M2 · `@boardstate/agent`** — the embeddable chat agent: provider adapters
  (`anthropicAdapter`, `openAICompatAdapter` — GLM, OpenAI, Ollama, any compatible
  endpoint), a streaming tool-loop runner, and the system-prompt composition guide.
- **M1 · The chat primitive** — `builtin:chat` + agent event streams: talk to the agent
  _inside_ the board it's building.
- **The reference app** — [the live app](https://100yenadmin.github.io/boardstate/app/):
  bring your own key, the agent builds your board in-browser.

## v0.1 — Extraction (2026-07-10)

The initial extraction from the modular-dashboard system its authors built for
[OpenClaw](https://github.com/openclaw/openclaw)
([upstream roadmap & PRs](https://github.com/openclaw/openclaw/issues/101136) — that
plugin remains the first conformant host) into a standalone, MIT-licensed monorepo: `schema` (the document + SPEC), `core` (headless store, bindings,
grid math, history), `server` (the `dashboard.*` control plane + agent tools + CLI), `host`
(sandbox mount + postMessage bridge), `lit` (the `<boardstate-view>` reference UI + builtin
widgets), `react` (typed wrappers), `mcp` (the MCP server), and `conformance` (the
transport test suite) — plus the two-tier widget security model (trusted builtins vs.
sandboxed customs: opaque origin, `connect-src 'none'`, capability manifests, operator
approval, server-side 404 for unapproved assets), themes (Graphite/Aurora/Vibrancy),
20-language localization, workspace templates, and the twenty48 sandboxed game.
