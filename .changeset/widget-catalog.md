---
"@boardstate/core": minor
"@boardstate/server": minor
"@boardstate/agent": patch
---

The builtin-widget catalog — first-try correctness for agent-built boards. The
first real external agent run (Hermes + GLM) guessed wrong widget prop/binding
shapes and mounted empty widgets; the catalog prevents it instead of the review
loop catching it after the fact.

- **`@boardstate/core`**: `WIDGET_CATALOG` / `DATA_SOURCE_WIDGET_KINDS` — per
  builtin kind, the exact binding keys + value shapes, props, and a
  copy-pasteable example; every example is validated against the workspace
  schema in a unit test, so a copied example always mounts non-empty.
- **`@boardstate/server`**: `dashboard_widget_catalog`, a readOnly tool in the
  browser-safe core tool set (flows through `@boardstate/mcp` as
  `boardstate_widget_catalog`). Optional `kind` filter.
- **`@boardstate/agent`**: the system prompt now points the model at the
  catalog before its first `widget_add`, and the composition guide's
  table/markdown/action-form lines are corrected (a table binds `rows`, a
  markdown binds `content` — data goes in `bindings.<key>`, never in props).

Two seam bugs fixed along the way (@boardstate/server):
- `dashboard_widget_update` (the agent tool) threw `unexpected param: tab` on
  EVERY call — the addressing fields were never stripped before the patch
  reader, so agents could never patch a widget. Fixed + regression-tested.
- Widget `props` sent as a JSON-encoded STRING (a routine model double-encode)
  sailed through validation and silently stripped every renderer's
  format/type/labels. The tool and RPC seams now coerce an unambiguous
  stringified object back to the object and reject other non-object props
  loudly.
