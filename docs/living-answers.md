# Living Answers

A convention for agents: when a question is **better shown than told**, answer it
with a live dashboard widget instead of (or alongside) a wall of chat text. The
widget stays bound to real data, so it keeps answering after the message scrolls
away — and it disappears on its own unless the user decides to keep it.

## When to reach for a Living Answer

Prefer a Living Answer when the reply is:

- **Numeric / time-varying** — "what's my spend today?", "how many sessions are
  running?" A bound widget re-reads the source; a pasted number goes stale.
- **Tabular** — a list the user will scan or re-check (sessions, cron jobs).
- **A follow-up action** — "want me to re-run it?" becomes a one-click form.

Prefer plain chat for one-off prose, explanations, or anything with no live data
behind it.

## The loop

1. **Reuse or create an `answers` tab.** Call `dashboard_workspace_get` first and
   look for a tab you can add to; otherwise `dashboard_tab_create` one (a stable
   slug like `answers` is ideal so you keep reusing it).
2. **Add a widget bound to live data.** Use `dashboard_widget_add` with an `rpc`
   binding to an allowlisted read method (see the widget-authoring notes for the
   list) — never paste a snapshot value when a binding exists.
3. **Mark it `ephemeral`.** Set `ephemeral.expiresAt` to an ISO 8601 timestamp,
   default **24h** out. The store sweeps it automatically once it expires, so the
   dashboard never fills up with stale answers.
4. **Reply in chat with one line + the tab link.** e.g. "Put a live cost tile on
   your **Answers** tab." Keep the prose short; the widget is the answer.
5. **Pin = permanence.** The widget shows a **Temporary** badge and a **Pin**
   action in its menu. Pinning clears the `ephemeral` flag (via
   `dashboard_widget_update` with `ephemeral: null`) so it stays for good. You
   never pin on the user's behalf — that's their call.

### TTL guidance

- Default `expiresAt` = now + 24h.
- Shorter (an hour or two) for a throwaway "let me check that" glance.
- Do not set an ephemeral flag on something the user explicitly asked to keep —
  add it un-flagged instead.

## Worked examples

Each is a single `dashboard_widget_add` tool call (assuming an `answers` tab
already exists; create it first if not). `expiresAt` values below are examples —
compute an actual now+24h timestamp.

### 1. A live number from a usage RPC

```json
{
  "tool": "dashboard_widget_add",
  "params": {
    "tab": "answers",
    "kind": "builtin:stat-card",
    "title": "Cost Today",
    "grid": { "x": 0, "y": 0, "w": 4, "h": 2 },
    "bindings": { "value": { "source": "rpc", "method": "usage.cost" } },
    "props": { "metric": "todayCost", "format": "usd" },
    "ephemeral": { "expiresAt": "2026-07-09T12:00:00Z" }
  }
}
```

Chat reply: "Added a live **Cost Today** tile to your Answers tab — it refreshes
on its own."

### 2. A table from a list RPC

```json
{
  "tool": "dashboard_widget_add",
  "params": {
    "tab": "answers",
    "kind": "builtin:table",
    "title": "Active Sessions",
    "grid": { "x": 0, "y": 2, "w": 6, "h": 5 },
    "bindings": { "rows": { "source": "rpc", "method": "sessions.list" } },
    "ephemeral": { "expiresAt": "2026-07-09T12:00:00Z" }
  }
}
```

Chat reply: "Your sessions are on the Answers tab as a live table."

### 3. An action-form follow-up

When the answer ends in "…want me to run it?", drop an `builtin:action-form`
instead of asking in prose. The `template` is authored by you and validated at
write time; only the declared field **values** vary when the user clicks, and
submission goes through the same operator-confirm + rate-limit gate as any other
prompt dispatch. Every `{slot}` in `template` MUST be a declared field name.

```json
{
  "tool": "dashboard_widget_add",
  "params": {
    "tab": "answers",
    "kind": "builtin:action-form",
    "title": "Re-run deploy",
    "grid": { "x": 6, "y": 2, "w": 6, "h": 5 },
    "props": {
      "template": "Deploy {service} to {env}",
      "fields": [
        { "name": "service", "label": "Service", "type": "text", "maxLength": 40 },
        { "name": "env", "label": "Environment", "type": "select", "options": ["staging", "prod"] }
      ],
      "buttonLabel": "Deploy"
    },
    "ephemeral": { "expiresAt": "2026-07-09T12:00:00Z" }
  }
}
```

Chat reply: "One-click re-run is on your Answers tab — pick the environment and
hit **Deploy** (you'll get a confirm before it sends)."

## Safety notes for action-form

- The template and field set are **workspace-authored, schema-validated, and
  provenance-stamped** — they do not come from click-time input.
- Field values are typed and length-capped (default 200 chars/field) and are
  interpolated in a single pass: a value that contains `{...}` is inserted
  literally and never re-expanded.
- Dispatch reuses the existing `sendPrompt` confirm + rate-limit path verbatim —
  an action-form grants **no new dispatch privilege** over a custom widget.

The tool names above (`dashboard_workspace_get`, `dashboard_tab_create`,
`dashboard_widget_add`, `dashboard_widget_update`) use the `dashboard_*`
protocol convention; MCP hosts may expose them prefixed as `boardstate_*`
instead — check your host's tool listing.

---

Adapted from the reference implementation's documentation (openclaw/openclaw#101136 series).
