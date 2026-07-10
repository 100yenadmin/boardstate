// Env-gated smoke for the Composio Tool Router recipe (#47). Proves the recipe end to
// end against the LIVE service: connect → listTools → call one readOnly tool. It SKIPS
// (exit 0) when the env refs / session URL aren't set, so CI stays green without keys.
//
//   COMPOSIO_API_KEY=… COMPOSIO_SESSION_URL="https://mcp.composio.dev/session/…" \
//   node examples/operational-demo/smoke/composio.mjs
//
// The session URL is per-user and minted via Composio's API (their `/link` migration
// landed 2026-07-03 — re-verify at setup time). See docs/connectors/composio.md.

import { McpBroker, composioPreset } from "@boardstate/broker";

const url = process.env.COMPOSIO_SESSION_URL;
const missing = composioPreset.envRefs.filter((name) => !process.env[name]);
if (!url) {
  missing.push("COMPOSIO_SESSION_URL");
}
if (missing.length > 0) {
  console.log(`[skip] Composio smoke — set ${missing.join(", ")} to run it.`);
  process.exit(0);
}

const config = composioPreset.build({ url });
const broker = new McpBroker({ connectors: [config] });

try {
  const manifest = await broker.listTools();
  console.log(`[ok] connected; ${manifest.tools.length} tool(s) discovered.`);
  const readable = manifest.tools.find((tool) => tool.readOnly === true);
  if (!readable) {
    console.log(
      "[warn] no readOnly tool advertised — connect + discover verified, skipping the call.",
    );
  } else {
    console.log(`[call] ${readable.id} (readOnly)…`);
    const result = await broker.callTool(readable.id, {});
    console.log("[ok] readOnly call returned:", JSON.stringify(result).slice(0, 400));
  }
} catch (error) {
  console.error("[fail]", error?.message ?? error);
  process.exitCode = 1;
} finally {
  await broker.close();
}
