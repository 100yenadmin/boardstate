# Boardstate templates

Full workspace documents (schema v1) ready to load as-is, plus starter `custom:` widgets.

| Template          | What it shows                                                                                                                                                                                                                                                                                                                                                          | Tabs                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `agent-hq.json`   | Fleet of AI agents — MRR/agent/approval stats, run history, throughput, an "answers" tab with a live Q&A markdown card and action-form, and an incidents/postmortem tab.                                                                                                                                                                                               | overview, fleet, answers, incidents |
| `smallbiz.json`   | "Driftwood Coffee" small-business HQ — today's revenue/orders/avg ticket with an hourly sales chart, low-stock inventory with reorder notes and a stock-health gauge, and a marketing tab with loyalty signups, campaign ROI, and a notes pad.                                                                                                                         | today, inventory, marketing         |
| `maintainer.json` | OSS maintainer HQ for a fictional `acme/rocket` repo — issue/PR/stale triage with a repo activity feed, CI build-success gauge with recent runs and known-flaky-tests notes, and sponsor/MRR financials with a donations trend and expense table.                                                                                                                      | triage, ci, financials              |
| `showcase.json`   | "Boardstate HQ" — every builtin widget kind, one workspace: stat cards/table/all four chart types on Data, sessions/usage/cron/instances/agent-status/activity/approvals on Operations, a markdown Q&A + action-form + notes pad on Content, and a sandboxed preview + raw iframe on Embeds. All bindings `static`.                                                    | data, ops, content, embeds          |
| `focus.json`      | Personal-productivity board built from builtins — session/minutes/streak stat cards, a "log a focus session" action-form, and an intentions notes pad on Focus; a deep-work minutes trend, sessions-by-day bars, a recent-sessions table, and a weekly-reflection markdown card on Review. A markdown card points to the `pomodoro` + `habit-tracker` gallery widgets. | focus, review                       |

`widgets/` holds starter `custom:` widget sources (`calculator`, `hello-data`, `notes`, `twenty48`, `pomodoro`, `habit-tracker`) — each is a small sandboxed HTML app plus a `widget.json` manifest, meant to be copied and adapted rather than loaded directly as a workspace document. `twenty48`, `pomodoro`, and `habit-tracker` are the `state:persist` examples (they save and restore their state through the `dashboard:getState` / `dashboard:setState` bridge).

## Loading a template

From the host UI, use **Import** in the view toolbar and pick one of these JSON files, or call the control-plane method directly:

```js
await client.call("dashboard.workspace.replace", { doc: <parsed template JSON>, actor: "user" });
```

This is a full-document replace — it runs the same §3 validation as every other write path, so any of these files can be handed straight to `dashboard.workspace.replace` without modification.

## Widget-gallery registry (`registry/`)

`registry/index.json` + the `*.bundle.json` files are a ready-to-serve **widget-gallery registry** containing the starter widgets above. Host the folder anywhere static (the live demo serves its copy at `https://100yenadmin.github.io/boardstate/registry/index.json`) and paste that URL into the view's **Widget gallery** dialog to browse and install. Bundles are regenerated from `widgets/` — edit the widget folders, not the bundle JSON.
