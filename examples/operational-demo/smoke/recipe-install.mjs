// Live keyless proof of the Ops-board recipe (#60): install the recipe THROUGH the import
// path into the operational-demo host (fake OfficeCLI, no keys), and assert the loop:
//
//   install (import) → grant arrives `requested` (never pre-granted) → connector.read is
//   refused while pending → operator approves → the board reads live fake-workbook data.
//
//   pnpm build && node examples/operational-demo/smoke/recipe-install.mjs
//
// Exits non-zero on any failed assertion (so it can gate CI); prints PASS on success.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryStorageAdapter, DashboardStore, buildRecipeImportDoc } from "@boardstate/core";
import { validateRecipe } from "@boardstate/schema";
import {
  createDashboardTools,
  createInProcessHost,
  installConnectorWorkspace,
  nodeRpcDeps,
  registerBoardstateRpc,
} from "@boardstate/server/node";
import { McpBroker } from "@boardstate/broker";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const CONNECTOR = "officecli";

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok: ${msg}`);
}

// ── the fake-OfficeCLI connector (no binary, no keys) ────────────────────────────────
const broker = new McpBroker({
  connectors: [
    {
      name: CONNECTOR,
      transport: "stdio",
      command: process.execPath,
      args: [join(HERE, "..", "fake-officecli.mjs")],
    },
  ],
});

const storage = new MemoryStorageAdapter();
const store = new DashboardStore({ storage });
const host = createInProcessHost(store, storage);
const workspace = installConnectorWorkspace(host, { broker, store });
host.registerTool(
  () =>
    createDashboardTools({
      store,
      broadcast: host.broadcast,
      toolSearch: workspace.toolSearch,
      context: { agentId: "assistant" },
    }),
  { names: [] },
);
registerBoardstateRpc(host, {
  store,
  ...nodeRpcDeps(),
  capabilityToolsHash: workspace.capabilityToolsHash,
});
await workspace.ready;

// ── install the recipe THROUGH the import seam ───────────────────────────────────────
const recipe = validateRecipe(
  JSON.parse(readFileSync(join(ROOT, "templates/registry/ops-board.recipe.json"), "utf8")),
);
const importDoc = buildRecipeImportDoc(recipe);
await host.request("dashboard.workspace.replace", { actor: "user", doc: importDoc });
// Reconcile the requested grant's tool surface to the connector's live manifest (the
// recipe declares intent; the broker owns the authoritative toolsHash) — same
// re-discover-after-replace step the demo does.
await workspace.refresh();

// ── grant arrived `requested`, never pre-granted ─────────────────────────────────────
let doc = await store.read();
let grant = doc.capabilitiesRegistry?.[CONNECTOR];
assert(grant, "recipe install created an officecli grant");
assert(grant.status === "requested", `grant is requested (was: ${grant?.status})`);
assert(grant.autoConfirm === undefined, "grant carries no auto-confirm lease");
assert(grant.expiresAt === undefined, "grant carries no TTL lease");
assert(
  (grant.tools ?? []).includes(`${CONNECTOR}:read_workbook`),
  "grant tools include read_workbook",
);

// ── a read is refused while the grant is pending (install can never grant) ───────────
let refused = false;
try {
  await host.request("dashboard.connector.read", { connector: CONNECTOR, tool: "read_workbook" });
} catch (err) {
  refused = /pending|grant/i.test(err?.message ?? String(err));
}
assert(refused, "connector.read is refused while the grant is pending");

// ── operator approves → the board reads live fake-workbook data ──────────────────────
await host.request("dashboard.capability.approve", {
  name: CONNECTOR,
  decision: "granted",
  actor: "user",
});
doc = await store.read();
grant = doc.capabilitiesRegistry?.[CONNECTOR];
assert(grant?.status === "granted", "grant is granted after operator approval");

const rows = await host.request("dashboard.connector.read", {
  connector: CONNECTOR,
  tool: "read_workbook",
});
const list = Array.isArray(rows) ? rows : (rows?.rows ?? rows?.structuredContent ?? rows);
const text = JSON.stringify(list);
assert(/Q1|Q2|Q3|quarter/i.test(text), "the board reads live workbook rows after approval");

console.log(
  "\nPASS: ops-board recipe installs, arrives pending, and reads live data after approval.",
);
process.exit(0);
