# Show HN — staged post (owner posts from their account)

## Title options (pick one; HN cuts ~80 chars)

1. **Show HN: Boardstate — open-source dashboards any AI can build, via MCP or your own key**
2. Show HN: Boardstate — your dashboard is data; any AI can build it, any human can edit it
3. Show HN: I extracted an agent-composable dashboard engine into an MIT library

## Body (ready to paste; keep under ~14 lines)

Boardstate is an MIT-licensed protocol + runtime for agent-composable dashboards.
The whole dashboard — tabs, widgets, layout, data bindings, even the registry of
agent-authored widgets — is one validated JSON document. An AI composes it through
tools, a human rearranges it with drag & drop, a script edits it over RPC — all
through the same guarded control plane, no privileged path.

Two ways to see it in 60 seconds:

- The app: pick a provider (GLM/z.ai, Anthropic, OpenAI, Ollama — your key stays
  in the browser; there's no server), type "build me a sales dashboard," and watch
  the board assemble while the chat streams its tool calls.
- MCP: point Claude (or any MCP client) at `npx @boardstate/mcp` — same 14 tools.

The part I'm most proud of: agent-authored widgets run in a sandbox strict enough
that foreign code is safe by construction (opaque-origin iframe, CSP connect-src
'none', capability manifest) and land pending until you approve them — the approval
moment happens inline in chat.

Live app: https://100yenadmin.github.io/boardstate/app/
Repo: https://github.com/100yenadmin/boardstate
8 packages on npm (`@boardstate/*`), spec in the repo, weekly releases.

Would love feedback on the protocol (SPEC.md) — especially the chat/agent-turn
event contract and the widget capability model.

## FAQ crib (for the comments)

- **Why not just artifacts/canvas?** Those render a document; this drives a live,
  persistent control plane with human parity (drag/drop, undo, approval) and a
  document you can diff/export/time-travel.
- **Key handling?** BYO-key, browser-memory by default, localStorage only if you
  opt in; requests go browser→provider directly. Self-hosting keeps keys server-side.
- **Provider lock-in?** Two adapters cover Anthropic-shaped and OpenAI-compatible
  endpoints (GLM, OpenAI, Together, Ollama). The agent loop is a client of the
  control plane — swap it out entirely if you want.
- **What's the sandbox story?** Widgets: sandboxed iframe, no network, no origin,
  parent-mediated data only, human approval gate. The AI cannot self-approve.
- **Prod-ready?** 0.x — protocol is stable enough to read, conformance suite ships,
  1.0 when the spec freezes. ~500 tests, adversarially reviewed (writeups in repo).
- **Relation to OpenClaw?** Extracted from the modular-dashboard system we built
  for it; OpenClaw is the first conformant host.

## Timing

Post Tue–Thu, 8–10am ET. Have the demo warm. First hour: answer everything.
