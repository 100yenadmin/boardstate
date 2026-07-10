# Pipedream MCP — thousands of app tools through one remote connector

[Pipedream MCP](https://pipedream.com/docs/connect/mcp) is a hosted remote MCP server that
fronts thousands of app tools (Slack, GitHub, Notion, …) over Streamable HTTP. Because
generic remote-MCP support is already the broker's, the Pipedream integration is a
**config recipe + a grant** — no code. The same operator-approval + pending-action gates
that govern OfficeCLI govern every Pipedream tool.

> **Re-verify at setup time.** Pipedream's MCP auth/endpoints moved during a 2026 cutover.
> Check the URL and header names against the live docs when you wire this up; the recipe is
> config-only, so drift never touches code.

## The recipe

```ts
import { pipedreamPreset } from "@boardstate/broker";

const connector = pipedreamPreset.build();
// → {
//     name: "pipedream", transport: "http",
//     url: "https://remote.mcp.pipedream.net/v3/mcp",
//     headers: {
//       Authorization: "Bearer ${PIPEDREAM_ACCESS_TOKEN}",
//       "x-pd-project-id": "${PIPEDREAM_PROJECT_ID}",
//       "x-pd-environment": "${PIPEDREAM_ENVIRONMENT}",
//       "x-pd-external-user-id": "${PIPEDREAM_EXTERNAL_USER_ID}"
//     }
//   }
```

`boardstate.connectors.json`:

```json
{
  "connectors": [
    {
      "name": "pipedream",
      "transport": "http",
      "url": "https://remote.mcp.pipedream.net/v3/mcp",
      "headers": {
        "Authorization": "Bearer ${PIPEDREAM_ACCESS_TOKEN}",
        "x-pd-project-id": "${PIPEDREAM_PROJECT_ID}",
        "x-pd-environment": "${PIPEDREAM_ENVIRONMENT}",
        "x-pd-external-user-id": "${PIPEDREAM_EXTERNAL_USER_ID}"
      }
    }
  ]
}
```

## Auth — env refs, resolved node-side ONLY

Every `${…}` is a **process-env reference**, interpolated by the broker at connect time.
No secret ever appears in the config file, a board JSON, or a browser (epic invariant #4):
**a board using this connector can be shared publicly without leaking anything.**

| Env var                      | What it is                                                      |
| ---------------------------- | --------------------------------------------------------------- |
| `PIPEDREAM_ACCESS_TOKEN`     | A short-lived bearer token minted from your client credentials. |
| `PIPEDREAM_PROJECT_ID`       | Your Pipedream project id.                                      |
| `PIPEDREAM_ENVIRONMENT`      | `development` or `production`.                                  |
| `PIPEDREAM_EXTERNAL_USER_ID` | The per-user connection selector — see below.                   |

Pipedream authenticates the developer with **client-credentials OAuth**
(`PIPEDREAM_CLIENT_ID` / `PIPEDREAM_CLIENT_SECRET` → an access token). The broker sends
_static_ env-ref headers, so mint the access token out-of-band and place it in
`PIPEDREAM_ACCESS_TOKEN`. In production, run a small **token-refresh sidecar** that renews
the token before it expires and updates the env the host reads — this is a documented
manual step, not broker code.

### Per-user connections (`external_user_id`)

Pipedream connects end-user accounts via **Connect Link**; each connection is keyed by an
`external_user_id` **you** assign. That mapping is server-side infrastructure —
`PIPEDREAM_EXTERNAL_USER_ID` lives in the host's env, **never** in a board or a browser.
The doc references the connector by name; it can never supply or read a user id.

## Rate limits + backoff

Pipedream meters usage (~10 QPS, credit-based). The broker already retries connects with
capped exponential backoff; keep board refresh intervals modest and prefer a few granted
tools over eager catalog loads. `boardstate_tool_search` never eager-loads the catalog —
it returns bounded, schema-free rows.

## Grant + use

Identical to any connector: the discovered tools land `requested`, the operator grants a
subset, a `readOnly` tool becomes a `source:"mcp"` binding and a mutating tool an
operator-confirmed `action-button`. Tool names are namespaced `pipedream:<tool>` /
`pipedream__<tool>`; the 64-char provider-name budget holds on real Pipedream tool names.

## Smoke test

```sh
PIPEDREAM_ACCESS_TOKEN=… PIPEDREAM_PROJECT_ID=… PIPEDREAM_ENVIRONMENT=development \
PIPEDREAM_EXTERNAL_USER_ID=… node examples/operational-demo/smoke/pipedream.mjs
```

It connects → lists tools → calls one `readOnly` tool, and **skips** (exit 0) without keys —
so CI never needs them. Override the endpoint with `PIPEDREAM_MCP_URL` if the cutover moved
it.
