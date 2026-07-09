// Live smoke for @boardstate/agent against a REAL provider — the proof that the
// tool loop drives an actual model end-to-end (recorded fixtures cover the wire
// shapes in CI; this exercises a live stream).
//
//   # GLM via z.ai's Anthropic-shaped endpoint (the anthropic adapter, live):
//   set -a; source ~/.openclaw/secrets/glm-zai.env; set +a
//   node examples/agent-smoke.mjs --glm-anthropic
//
//   # GLM via z.ai's OpenAI-shaped endpoint (the openai-compat adapter, live):
//   node examples/agent-smoke.mjs --glm-openai        # same env sourced
//
//   # Any Anthropic key:
//   ANTHROPIC_API_KEY=... node examples/agent-smoke.mjs --anthropic
//
//   # Self-review (M4a): append --self-review to any mode — runs the build through
//   # createAgentChatAgent({ selfReview: "once" }) and asserts the review pass called
//   # dashboard_design_review within the same single chat turn.
//
// Keys are read from the environment and NEVER printed: output is limited to event
// types + tool names, and a self-check refuses to print anything containing a
// credential substring.

import { MemoryStorageAdapter, DashboardStore } from "../packages/core/dist/index.js";
import {
  createInProcessHost,
  registerBoardstateRpc,
  createDashboardTools,
} from "../packages/server/dist/node.js";
import {
  runAgentTurn,
  buildSystemPrompt,
  createAgentChatAgent,
  anthropicAdapter,
  openAICompatAdapter,
} from "../packages/agent/dist/index.js";
import { validateWorkspaceDoc } from "../packages/schema/dist/index.js";

const mode = process.argv[2] ?? "--glm-anthropic";
const selfReview = process.argv.includes("--self-review");
const MODEL = process.env.SMOKE_MODEL ?? (mode === "--anthropic" ? "claude-sonnet-5" : "glm-4.7");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`missing env: ${name} (source the provider env first)`);
    process.exit(2);
  }
  return value;
}

let provider;
if (mode === "--glm-anthropic") {
  provider = anthropicAdapter({
    apiKey: requireEnv("ANTHROPIC_AUTH_TOKEN"),
    baseUrl: requireEnv("ANTHROPIC_BASE_URL"),
    model: MODEL,
  });
} else if (mode === "--glm-openai") {
  provider = openAICompatAdapter({
    apiKey: requireEnv("ANTHROPIC_AUTH_TOKEN"),
    baseUrl: "https://api.z.ai/api/paas/v4",
    model: MODEL,
  });
} else if (mode === "--anthropic") {
  provider = anthropicAdapter({ apiKey: requireEnv("ANTHROPIC_API_KEY"), model: MODEL });
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}

// Secret-echo guard: nothing printed may contain a credential substring.
const secrets = [process.env.ANTHROPIC_AUTH_TOKEN, process.env.ANTHROPIC_API_KEY].filter(Boolean);
function safe(line) {
  for (const secret of secrets) {
    if (secret && line.includes(secret.slice(0, 12))) {
      return "[REDACTED LINE — contained credential material]";
    }
  }
  return line;
}
const say = (line) => console.log(safe(line));

const storage = new MemoryStorageAdapter();
const store = new DashboardStore({ storage });
const host = createInProcessHost(store, storage);
registerBoardstateRpc(host, { store });
await host.request("dashboard.workspace.replace", {
  doc: {
    schemaVersion: 1,
    workspaceVersion: 1,
    tabs: [
      {
        slug: "home",
        title: "Home",
        hidden: false,
        createdBy: "system",
        widgets: [],
      },
    ],
    widgetsRegistry: {},
    prefs: { tabOrder: ["home"] },
  },
  actor: "user",
});

const tools = createDashboardTools({
  store,
  context: { agentId: "agent:smoke" },
  broadcast: host.broadcast,
});
const events = [];
const toolCalls = [];
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 240_000);

say(`smoke: mode=${mode} model=${MODEL} tools=${tools.length} selfReview=${selfReview}`);
const userMessage =
  "Build an 'Insights' tab (slug 'insights') with exactly three widgets: " +
  "a stat card (props: value 42184, format 'usd', label 'Pipeline'), an area chart " +
  "with 10 upward-trending points (kind builtin:chart, props type 'area', bindings " +
  "value static array), and a markdown note with two bullets. Use the exact prop and " +
  "binding shapes from your composition guide. Then stop.";
const emit = (event) => {
  events.push(event.type);
  if (event.type === "tool-call-ready") {
    toolCalls.push(event.name);
    say(`  tool → ${event.name}`);
  }
  if (event.type === "tool-result") say(`  result ← ok=${event.ok}`);
  if (event.type === "error") say(`  error: ${event.code} retryable=${event.retryable}`);
  if (event.type === "turn-end") say(`  turn-end: ${event.stopReason}`);
};
if (selfReview) {
  // The M4a loop: build turn + ONE bounded review pass, a single §14 turn on the wire.
  const chatAgent = createAgentChatAgent({
    provider,
    tools,
    selfReview: "once",
    tokenCeiling: 60_000,
  });
  await chatAgent(
    { sessionKey: "smoke", message: userMessage },
    { emit, signal: controller.signal, turnId: "smoke-1" },
  );
} else {
  await runAgentTurn({
    tools,
    provider,
    system: buildSystemPrompt(tools),
    userMessage,
    emit,
    signal: controller.signal,
    sessionKey: "smoke",
    turnId: "smoke-1",
    tokenCeiling: 60_000,
  });
}
clearTimeout(timeout);

const doc = (await host.request("dashboard.workspace.get")).doc;
let valid = true;
try {
  validateWorkspaceDoc(doc);
} catch (error) {
  valid = false;
  say(`doc INVALID: ${error.message}`);
}
const insights = doc.tabs.find((tab) => tab.slug === "insights");
const widgetCount = insights?.widgets.length ?? 0;
const created = toolCalls.filter((name) => name.includes("tab_create")).length;
const added = toolCalls.filter((name) => name.includes("widget_add")).length;

say(
  `events: ${events.length} · toolCalls: ${toolCalls.length} (${created} tab_create, ${added} widget_add)`,
);
say(
  `insights tab: ${insights ? "present" : "MISSING"} with ${widgetCount} widgets · doc valid: ${valid}`,
);

let pass = created >= 1 && added >= 2 && widgetCount >= 3 && valid && events.at(-1) === "turn-end";
if (selfReview) {
  const reviewed = toolCalls.includes("dashboard_design_review");
  const singleTurn =
    events.filter((type) => type === "turn-start").length === 1 &&
    events.filter((type) => type === "turn-end").length === 1;
  say(`self-review: design_review called=${reviewed} · single wire turn=${singleTurn}`);
  pass = pass && reviewed && singleTurn;
}
say(pass ? "SMOKE PASS" : "SMOKE FAIL");
process.exit(pass ? 0 : 1);
