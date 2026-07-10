// Env-gated smoke for the Pipedream MCP recipe (#47). Proves the recipe end to end
// against the LIVE service: connect → listTools → call one readOnly tool. It SKIPS
// (exit 0) when the env refs aren't set, so CI stays green without keys.
//
//   PIPEDREAM_ACCESS_TOKEN=… PIPEDREAM_PROJECT_ID=… PIPEDREAM_ENVIRONMENT=development \
//   PIPEDREAM_EXTERNAL_USER_ID=… node examples/operational-demo/smoke/pipedream.mjs
//
// The access token is minted out-of-band from your client credentials (see
// docs/connectors/pipedream.md). Endpoints moved during the 2026 cutover — re-verify the
// URL against Pipedream's live docs; override it with PIPEDREAM_MCP_URL if needed.

import { McpBroker, pipedreamPreset } from "@boardstate/broker";

const required = pipedreamPreset.envRefs;
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.log(`[skip] Pipedream smoke — set ${missing.join(", ")} to run it.`);
  process.exit(0);
}

const config = pipedreamPreset.build(
  process.env.PIPEDREAM_MCP_URL ? { url: process.env.PIPEDREAM_MCP_URL } : {},
);
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
