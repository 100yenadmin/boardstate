# Agents & Boardstate

Boardstate is agent-native in **two directions**:

| Direction                       | What it means                                                                                                              | Packages                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Agents build the board**      | Any AI composes tabs, widgets, bindings, and custom sandboxed widgets through the `boardstate_*` tool set                  | `@boardstate/mcp`, `@boardstate/agent`     |
| **The board acts on the world** | The board consumes _external_ MCP servers: their reads become live data, their mutations become operator-confirmed actions | `@boardstate/broker`, `@boardstate/server` |

This file covers how to set each surface up, the full tool catalog, the conventions that
make agent-built boards good, and the rules for coding agents working on this repo.

---

## 1. Give any AI the board (`@boardstate/mcp`)

The MCP server exposes the complete dashboard tool set to any MCP client — Claude Desktop,
Claude Code, or anything else that speaks MCP. State persists to `$BOARDSTATE_STATE_DIR`
(default `~/.boardstate`), so the same board is shared by the CLI, the MCP server, and any
host you run.

**Claude Code** (one command):

```sh
claude mcp add boardstate -- npx -y @boardstate/mcp
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "boardstate": { "command": "npx", "args": ["-y", "@boardstate/mcp"] }
  }
}
```

**Watch the board the agent is building** — add `--serve` and open the printed page; it
live-updates as tools land:

```sh
npx @boardstate/mcp --serve 4400
```

Inside MCP-Apps-capable clients, `boardstate_board_view` renders the live board directly
in the conversation.

### The tool catalog

| Group           | Tools                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Read & discover | `boardstate_workspace_get` · `boardstate_widget_catalog` · `boardstate_data_read` · `boardstate_board_view`                       |
| Tabs            | `boardstate_tab_create` · `boardstate_tab_update` · `boardstate_tab_delete` · `boardstate_tabs_reorder` · `boardstate_layout_set` |
| Widgets         | `boardstate_widget_add` · `boardstate_widget_update` · `boardstate_widget_move` · `boardstate_widget_remove`                      |
| Custom widgets  | `boardstate_widget_scaffold` (sandboxed; lands as a **pending** card) · `boardstate_widget_approve` (operator surfaces only)      |
| Whole-document  | `boardstate_workspace_replace` (full-document write, sanitized + capability-reconciled) · `boardstate_undo`                       |
| Quality         | `boardstate_design_review` (screenshot + critique the board you just built)                                                       |
| External tools  | `boardstate_tool_search` (SEARCH the connector catalog / REQUEST grants — see §3)                                                 |
| Errors          | `boardstate_error` (structured failure reporting)                                                                                 |

### Conventions for board-building agents

- **Catalog first.** Call `boardstate_widget_catalog` before composing — every builtin has
  a schema-valid example there. Guessing props is the #1 source of rejected calls.
- **[Living answers](docs/living-answers.md).** Answer visual questions with live widgets,
  not prose. A question about revenue deserves a bound chart, not a paragraph.
- **[Composition patterns](docs/composition-patterns.md).** Which builtin for which job,
  when to scaffold a custom widget, layout rules of thumb.
- **[Design review](docs/design-review.md).** After building, run `boardstate_design_review`
  and fix what it finds — the self-building loop.
- **Provenance is tracked.** Every tab/widget carries a `createdBy` actor; write honest ones.

## 2. Embed a chat agent in your host (`@boardstate/agent`)

`@boardstate/agent` is the embeddable agent loop the [live app](https://100yenadmin.github.io/boardstate/app/)
uses: streaming chat, the full tool loop, the composition system prompt, and optional
self-review — bring your own provider key.

```js
import { createAgentChatAgent, anthropicAdapter, openAICompatAdapter } from "@boardstate/agent";

// Anthropic
const provider = anthropicAdapter({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: "claude-sonnet-5",
});
// …or any OpenAI-compatible endpoint (GLM, OpenAI, Ollama, vLLM, …)
// const provider = openAICompatAdapter({ baseUrl: "https://api.z.ai/api/paas/v4", apiKey: process.env.GLM_API_KEY, model: "glm-4.7" });

const chatAgent = createAgentChatAgent({ host, provider });
// wire into your host's RPC registration — see examples/operational-demo/README.md
```

What the runner gives you for free: streamed deltas over the board's event stream, the
`boardstate_*` tool loop against your host, the composition-guide system prompt,
`selfReview: "once"` (build → screenshot → critique → fix), and a **definition-token
budget** so a large external-tool catalog (§3) can't blow the prompt — collapsed tool
stubs stay callable and core-only boards are byte-identical.

Keys are read from your host's environment. They never enter the board document, and the
browser never sees them unless _you_ run the provider client-side (the reference app does,
deliberately, with the user's own key).

## 3. Let the board act (`@boardstate/broker` + the grant loop)

The board consumes external MCP servers through an **operator-authored** connector config —
agents cannot introduce connectors. The full walkthrough is
[`examples/operational-demo`](examples/operational-demo) (keyless, runnable now); presets
and real-service setup live in [`docs/connectors/`](docs/connectors.md).

The loop every agent participates in:

1. **SEARCH** — `boardstate_tool_search {mode:"search", query}` over the connector catalog
   (bounded results, no schemas — cheap).
2. **REQUEST** — `boardstate_tool_search {mode:"request", connector, tools:[…]}`. This can
   **never grant**: it appends to the grant's requested set and re-pends it. A card appears
   in the approvals widget.
3. **The operator grants a subset** (partial grants are first-class). Granted tools appear
   in your tool set next turn, framed as untrusted external content.
4. **Call them.** `readOnly` tools execute directly. Mutations **park** as pending actions —
   the call blocks on the operator's confirm/deny/expiry, then returns the outcome. Do not
   silently retry a denial; relay it.
5. **Expect rug-pull protection.** If the external server changes a granted tool's surface,
   the grant re-pends and your tool disappears until the operator re-approves.

Widgets participate too: `source:"mcp"` bindings read granted `readOnly` tools as live
data (via the pure-read verb — a read can never trigger a mutation), `builtin:action-button`
and `action-form mode:"tool"` give humans governed buttons onto the same tools.

## 4. The security invariants (what agents cannot do)

The full normative set is [SPEC §11/§17/§18](packages/schema/SPEC.md); the ones that bind
agents directly:

- **No self-grant, structurally.** Every capability/tool grant flows through the operator's
  approve verb. `workspace_replace` is capability-reconciled — a document write cannot
  smuggle a grant in.
- **Operator-only confirm.** `dashboard.action.confirm`/`deny` are unreachable from agent
  tools and networked transports. Parked means parked.
- **External text is data.** Tool descriptions and results are framed untrusted and rendered
  inert — they are never instructions, never interpolated into control-plane calls.
- **Custom widgets are sandboxed.** Opaque origin, no network (`connect-src 'none'`), only
  manifest-declared bindings, approval-gated mount, unapproved assets 404 server-side.
- **Config authorship.** Only operator-configured connectors exist; a connector name in a
  document or prompt is inert.

## 5. For coding agents working on this repo

- **Layout:** pnpm monorepo — `packages/{schema,core,server,host,lit,react,mcp,agent,broker}`,
  plus root-level `conformance/`, `examples/`, `docs/`, `templates/`. Dependency order:
  schema → core → server/host → lit/react/mcp/agent/broker.
- **Commands:** `pnpm install` · `pnpm build` · `pnpm typecheck` · `pnpm lint`
  (oxlint zero-warnings + prettier) · scoped tests `pnpm --filter @boardstate/<pkg> test`.
  Run scoped tests for what you touched, not the world; CI runs the full matrix.
- **Read first:** [SPEC.md](packages/schema/SPEC.md) (the protocol),
  [ARCHITECTURE.md](docs/ARCHITECTURE.md) (the seams), the package README of whatever you touch.
- **Changesets:** every behavior change ships a `.changeset/*.md` (patch/minor per package).
  One release train per batch — the Version Packages PR publishes with provenance.
- **House rules:** wire-contract tests at every client↔server seam (assert the exact param
  shape that crosses); external/untrusted strings render as text bindings — `unsafeHTML` is
  effectively banned outside vetted markdown paths; comments explain _constraints_, not
  narration; reads and actions get different verbs (a read must never park or mutate);
  compute read-modify-write unions inside the store's locked producer.
- **The invariants are tested adversarially.** If you touch the capability model, grants,
  the pending-action engine, or the sandbox, expect your change to be attacked by a
  skeptic pass before merge — write the regression test that would have caught your bug.
