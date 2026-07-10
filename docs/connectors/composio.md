# Composio Tool Router — per-user tool sessions through one remote connector

[Composio's Tool Router](https://docs.composio.dev/) exposes a user's connected apps as a
remote MCP server reached at a **per-user session URL**, authenticated with an `x-api-key`.
Like Pipedream, the Boardstate integration is a **config recipe + a grant** — the broker's
generic remote-MCP support does the rest, and every Composio tool flows through the same
operator-approval + pending-action gates.

> **Re-verify at setup time.** Composio's `/link` migration landed 2026-07-03 and the API
> surface evolves. Mint the session URL from the current API and check header names against
> the live docs; the recipe is config-only, so drift never touches code.

## The recipe

The session URL is **per-user** and minted via Composio's API, so you supply it — the
preset fills in the env-ref API key header:

```ts
import { composioPreset } from "@boardstate/broker";

const connector = composioPreset.build({
  url: "https://mcp.composio.dev/session/<per-user-session-id>",
});
// → {
//     name: "composio", transport: "http",
//     url: "https://mcp.composio.dev/session/<…>",
//     headers: { "x-api-key": "${COMPOSIO_API_KEY}" }
//   }
```

`boardstate.connectors.json`:

```json
{
  "connectors": [
    {
      "name": "composio",
      "transport": "http",
      "url": "https://mcp.composio.dev/session/<per-user-session-id>",
      "headers": { "x-api-key": "${COMPOSIO_API_KEY}" }
    }
  ]
}
```

## Auth — an env ref, resolved node-side ONLY

`${COMPOSIO_API_KEY}` is a **process-env reference**, resolved by the broker at connect
time. The key never appears in the config file, a board JSON, or a browser (epic invariant
#4): a board using this connector is safe to share publicly.

The **session URL encodes the user**; mint one per end-user server-side and keep the
mapping in your infrastructure — the doc references the connector by name and can neither
supply nor read a session URL.

## Dynamic discovery meets granted-only exposure

Composio's Tool Router does provider-side **dynamic tool discovery** — the catalog it
advertises can change as the user's connected apps change. That interplays cleanly with
Boardstate's model: a discovered tool is **inert until the operator grants it**, and the
broker's manifest-hash re-pend (SPEC §17.1) re-pends a granted tool whose schema drifts.
Discovery widens what's _searchable_ (`boardstate_tool_search`), never what's _callable_.

## Grant + use

The discovered tools land `requested`; the operator grants a subset; a `readOnly` tool
becomes a `source:"mcp"` binding and a mutating tool an operator-confirmed `action-button`.
Names are namespaced `composio:<tool>` / `composio__<tool>` — the 64-char provider-name
budget holds on real Composio tool names.

## Smoke test

```sh
COMPOSIO_API_KEY=… COMPOSIO_SESSION_URL="https://mcp.composio.dev/session/…" \
node examples/operational-demo/smoke/composio.mjs
```

It connects → lists tools → calls one `readOnly` tool, and **skips** (exit 0) without keys.
