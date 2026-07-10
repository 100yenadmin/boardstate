---
"@boardstate/schema": minor
"@boardstate/core": minor
"@boardstate/host": minor
"@boardstate/lit": minor
"@boardstate/agent": minor
---

Installable template recipes (#60) + board-as-agent-memory (#61).

- **Template recipes (#60, `@boardstate/schema` + `@boardstate/core`).** A new
  `TemplateRecipe` format (`validateRecipe`) = a workspace doc + a `grantsManifest`
  (connector → requested tools with human labels), schema-validated and static-hostable
  (the registry index gains a `recipes[]` array). **Install = import:** the board is applied
  through the existing distribution re-pend seam (`buildRecipeImportDoc` →
  `sanitizeImportedWorkspace` → `dashboard.workspace.replace`), so every manifest grant
  lands `requested` and custom widgets `pending` — a recipe can **never** arrive
  pre-granted (proven at store ground truth through `reconcileReplaceApproval`). Ships two
  operational recipes — a keyless **Ops board** (the operational-demo's fake OfficeCLI
  connector, live end to end) and a **SaaS metrics + actions** board (builtins + an
  aggregator-shaped manifest) — plus an **Agent memory** template.
- **Templates gallery tab (#60, `@boardstate/lit`).** The widget-gallery dialog grows a
  **Templates** tab that browses recipes and renders each recipe's honest "this board will
  ask for these tools" grant list before install; installing navigates to the board and the
  approvals widget surfaces the pending grant cards. New locale keys land in all five
  complete locales.
- **Board-as-memory (#61, `@boardstate/agent`).** Opt-in `memory: "board"` on
  `createAgentChatAgent`: the system prompt gains the memory conventions
  (`buildSystemPrompt(tools, { memory: "board" })` / `MEMORY_CONVENTIONS`) and the runner
  **primes each turn** by reading a `memory` tab through the existing
  `dashboard_workspace_get` verb (no new tools). Additive and default-off — the prompt is
  byte-identical when off. See `docs/board-as-memory.md`.
