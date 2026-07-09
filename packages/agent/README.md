# @boardstate/agent

The provider loop that turns any LLM into a Boardstate dashboard-building agent. It is a
**client of the control plane** — it asks a model what to do and executes each tool call
through the same `dashboard.*` methods a human and the CLI use. No provider key or network
egress ever touches `@boardstate/core`.

```ts
import { registerBoardstateRpc, createChatSessions, createInProcessHost } from "@boardstate/server";
import { createAgentChatAgent, anthropicAdapter } from "@boardstate/agent";

const host = createInProcessHost(store, storage);
const chat = createChatSessions({ broadcast: host.broadcast });
const chatAgent = createAgentChatAgent({
  host,
  provider: anthropicAdapter({ apiKey: process.env.ANTHROPIC_API_KEY!, model: "claude-..." }),
});
registerBoardstateRpc(host, { store, chat, chatAgent /* ...other opts */ });
```

Any OpenAI-compatible endpoint (GLM/z.ai, OpenAI, Together, Ollama) works via
`openAICompatAdapter({ baseUrl, apiKey, model })`.

## What it provides

- **`runAgentTurn(...)`** — the streaming loop: forwards provider deltas as
  `AgentStreamEvent`s (SPEC §14), executes read-only tools in parallel and mutating tools
  serially, enforces per-turn token + iteration ceilings, and retries transient provider
  failures (429/5xx/timeout) with exponential backoff.
- **`createAgentChatAgent(...)`** — adapts a provider into the `ChatAgent` that
  `chat.send` runs, with in-memory per-session history and truncation-first context
  management.
- **`ProviderAdapter` + `anthropicAdapter` + `openAICompatAdapter`** — streaming
  normalization for the two provider families.
- **`buildSystemPrompt(tools)` + `compositionGuideTool`** — a compact composition prompt
  distilled from `docs/composition-patterns.md`.

## Security

Keys are passed in by the host and never logged or written to the workspace document.
Observed board/tool content is treated as **data, not instructions**. AI-scaffolded custom
widgets still land `pending` behind the approval gate.
