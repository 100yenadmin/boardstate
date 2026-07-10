// The Operational Workspace demo (epic #37): an agent-composable board that READS live
// external data through a granted connector and ACTS through operator-confirmed tools —
// the whole M5 stack wired into ONE runnable Node host.
//
//   pnpm build                                              # once, from the repo root
//   node examples/operational-demo/demo.mjs                 # then open the two URLs it prints
//   OFFICECLI_REAL=1 node examples/operational-demo/demo.mjs # drive the REAL `officecli mcp`
//
// Two surfaces, and the boundary between them IS the point:
//   • http://localhost:4700/          — the NETWORKED board (served over the WS transport
//     with the default allowOperatorMethods:false). It renders the workbook via a
//     `source:"mcp"` read binding and can PARK the "generate document" action — but it
//     can NEVER confirm it.
//   • http://localhost:4700/operator  — the LOCAL operator console (loopback-only). It
//     approves the connector's tool grant and confirms/denies parked actions by driving
//     the IN-PROCESS host directly. This is the local operator; a networked client is not.
//
// Everything is USERLAND: the M5 pieces are assembled with `installConnectorWorkspace`
// (@boardstate/server/node) over an McpBroker (@boardstate/broker) built from an
// operator-authored connectors config — no core changes, secrets stay node-side.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryStorageAdapter, DashboardStore } from "@boardstate/core";
import {
  attachWsTransport,
  createDashboardTools,
  createInProcessHost,
  installConnectorWorkspace,
  nodeRpcDeps,
  registerBoardstateRpc,
} from "@boardstate/server/node";
import { McpBroker, officeCliPreset, detectBinary } from "@boardstate/broker";

const PORT = Number(process.env.PORT ?? 4700);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CONNECTOR = "officecli";

// ── the connector config: the REAL `officecli mcp`, or the CI-free fake double ────────
const useReal = process.env.OFFICECLI_REAL === "1";
if (useReal && !detectBinary(officeCliPreset.requiresBinary.command)) {
  console.error(
    `\nOFFICECLI_REAL=1 but the binary is missing.\n${officeCliPreset.requiresBinary.install}\n`,
  );
  process.exit(1);
}
const connectorConfig = useReal
  ? officeCliPreset.build({ name: CONNECTOR })
  : {
      name: CONNECTOR,
      transport: "stdio",
      command: process.execPath, // this Node
      args: [join(HERE, "fake-officecli.mjs")],
    };

const broker = new McpBroker({ connectors: [connectorConfig] });

// ── the host + the whole M5 stack in one call ─────────────────────────────────────────
const storage = new MemoryStorageAdapter();
const store = new DashboardStore({ storage });
const host = createInProcessHost(store, storage);
const workspace = installConnectorWorkspace(host, { broker, store });

// The dashboard tool set (incl. boardstate_tool_search) as a per-turn host factory, so a
// wired-in agent sees granted tools appear the turn after the operator approves them.
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

// ── the board: workbook table (read binding) + a document action (parks on confirm) ──
await host.request("dashboard.workspace.replace", {
  actor: "user",
  doc: {
    schemaVersion: 1,
    workspaceVersion: 1,
    prefs: { tabOrder: ["report"] },
    widgetsRegistry: {},
    tabs: [
      {
        slug: "report",
        title: "Quarterly report",
        hidden: false,
        createdBy: "system",
        widgets: [
          {
            id: "about",
            kind: "builtin:markdown",
            title: "What you're looking at",
            grid: { x: 0, y: 0, w: 12, h: 2 },
            collapsed: false,
            hidden: false,
            props: {
              markdown:
                "**Live external data + a governed action.** The table below reads a " +
                'workbook through a granted `officecli` tool (`source:"mcp"`). The button ' +
                "generates a document through a *mutating* tool — it PARKS until the local " +
                "operator confirms it. Approve the grant in the [operator console](/operator).",
            },
          },
          {
            id: "workbook",
            kind: "builtin:table",
            title: "Revenue by quarter (live from the workbook)",
            grid: { x: 0, y: 2, w: 8, h: 5 },
            collapsed: false,
            hidden: false,
            // A readOnly `source:"mcp"` binding: resolved host-side via the broker, gated
            // on the granted tool. Renders nothing until the operator grants read_workbook.
            bindings: {
              value: { source: "mcp", connector: CONNECTOR, tool: "read_workbook" },
            },
            props: { columns: ["quarter", "region", "revenue", "deals"] },
          },
          {
            id: "generate",
            kind: "builtin:action-button",
            title: "Generate the report document",
            grid: { x: 8, y: 2, w: 4, h: 5 },
            collapsed: false,
            hidden: false,
            props: {
              connector: CONNECTOR,
              tool: "generate_document",
              label: "Generate .docx",
              args: { title: "Quarterly Revenue Report", format: "docx" },
            },
          },
        ],
      },
    ],
  },
});

// A full workspace.replace rewrites the whole doc (reconcile drops the boot-registered
// grant), so re-discover + re-register the connector's `requested` grant now that the
// board is in place — exactly the connector-sidecar's "install the grant after the board"
// note, generalized to the broker's grant registration.
await workspace.refresh();

// ── the local operator console (loopback-only) ────────────────────────────────────────
// These routes drive the IN-PROCESS host — the true local operator. They are refused for
// any non-loopback client, so "operator" means "on this machine", never a networked view.

function isLoopback(req) {
  const addr = req.socket.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function handleOperator(req, res, pathname) {
  if (!isLoopback(req)) {
    res.writeHead(403).end("operator console is loopback-only");
    return true;
  }
  if (pathname === "/operator") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(OPERATOR_PAGE);
    return true;
  }
  if (pathname === "/operator/state") {
    const doc = await store.read();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        grant: doc.capabilitiesRegistry?.[CONNECTOR] ?? null,
        pending: workspace.actions.pendingActions(),
        audit: workspace.actions.auditLog().slice(-10),
      }),
    );
    return true;
  }
  if (req.method === "POST" && pathname === "/operator/approve") {
    try {
      await host.request("dashboard.capability.approve", {
        name: CONNECTOR,
        decision: "granted",
        actor: "user",
      });
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
    } catch (error) {
      res
        .writeHead(400, { "Content-Type": "application/json" })
        .end(JSON.stringify({ ok: false, error: error?.message ?? String(error) }));
    }
    return true;
  }
  if (
    req.method === "POST" &&
    (pathname === "/operator/confirm" || pathname === "/operator/deny")
  ) {
    const body = await readJsonBody(req);
    const method = pathname.endsWith("confirm")
      ? "dashboard.action.confirm"
      : "dashboard.action.deny";
    try {
      const result = await host.request(method, { id: body.id, actor: "user" });
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ ok: true, result }));
    } catch (error) {
      res
        .writeHead(400, { "Content-Type": "application/json" })
        .end(JSON.stringify({ ok: false, error: error?.message ?? String(error) }));
    }
    return true;
  }
  return false;
}

// ── the networked board page (same lit browser bundle every face uses) ────────────────
const PAGE = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8"><title>Boardstate — operational workspace</title>
<link rel="stylesheet" href="/pkg/lit/styles.css">
<script type="importmap">{"imports":{
  "@boardstate/schema":"/pkg/schema/index.js",
  "@boardstate/core":"/pkg/core/index.js"
}}</script>
<style>body{margin:0;background:var(--bs-bg,#0b0b0f);color:var(--bs-text,#ededf2);font-family:-apple-system,system-ui,sans-serif}#app{padding:16px 20px}</style>
</head>
<body>
<div id="app"></div>
<script type="module">
  import "/pkg/lit/browser.js";
  import { createWsTransport } from "@boardstate/core";
  const view = document.createElement("boardstate-view");
  view.transport = createWsTransport("ws://" + location.host + "/ws");
  view.connected = true;
  document.getElementById("app").appendChild(view);
</script>
</body>
</html>`;

const OPERATOR_PAGE = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8"><title>Operator console</title>
<style>
  body{margin:0;background:#0b0b0f;color:#ededf2;font-family:-apple-system,system-ui,sans-serif;padding:24px}
  h1{font-size:18px}h2{font-size:14px;color:#9aa;margin-top:24px}
  button{background:#2b6;border:0;color:#031;padding:6px 12px;border-radius:6px;cursor:pointer;font-weight:600}
  button.deny{background:#a44;color:#fee}
  pre{background:#16161c;padding:12px;border-radius:8px;overflow:auto;font-size:12px}
  .row{display:flex;gap:8px;align-items:center;margin:6px 0}
</style>
</head>
<body>
<h1>Operator console <small style="color:#8ab">(loopback-only)</small></h1>
<p>Approve the connector grant, then confirm the parked "generate document" actions the board sends.</p>
<div class="row"><button onclick="approve()">Approve officecli grant</button></div>
<h2>Grant</h2><pre id="grant">…</pre>
<h2>Pending actions</h2><div id="pending"></div>
<h2>Recent audit</h2><pre id="audit">…</pre>
<script>
  async function refresh(){
    const s = await (await fetch('/operator/state')).json();
    document.getElementById('grant').textContent = JSON.stringify(s.grant, null, 2);
    document.getElementById('audit').textContent = JSON.stringify(s.audit, null, 2);
    const box = document.getElementById('pending');
    box.innerHTML = '';
    for (const a of s.pending){
      const div = document.createElement('div'); div.className='row';
      div.innerHTML = '<code>'+a.tool+'</code> <button onclick="confirmId(\\''+a.id+'\\')">Confirm</button>'
        + '<button class="deny" onclick="denyId(\\''+a.id+'\\')">Deny</button>';
      box.appendChild(div);
    }
  }
  async function approve(){ await fetch('/operator/approve',{method:'POST'}); refresh(); }
  async function confirmId(id){ await fetch('/operator/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}); refresh(); }
  async function denyId(id){ await fetch('/operator/deny',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}); refresh(); }
  refresh(); setInterval(refresh, 1500);
</script>
</body>
</html>`;

// ── static serving for the browser bundle (schema/core/lit dist) ─────────────────────
const PKG_ROOTS = {
  schema: join(ROOT, "packages/schema/dist"),
  core: join(ROOT, "packages/core/dist"),
  lit: join(ROOT, "packages/lit/dist"),
};
const MIME = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  void (async () => {
    try {
      if (pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(PAGE);
      }
      if (pathname.startsWith("/operator")) {
        if (await handleOperator(req, res, pathname)) {
          return undefined;
        }
        res.writeHead(404).end("not found");
        return undefined;
      }
      if (pathname === "/pkg/lit/styles.css") {
        const css = readFileSync(join(PKG_ROOTS.lit, "styles.css"));
        res.writeHead(200, { "Content-Type": MIME[".css"] });
        return res.end(css);
      }
      const match = pathname.match(/^\/pkg\/(schema|core|lit)\/(.+)$/);
      if (match) {
        const rootDir = PKG_ROOTS[match[1]];
        const file = normalize(join(rootDir, match[2]));
        if (!file.startsWith(rootDir)) {
          throw new Error("traversal");
        }
        const body = readFileSync(file);
        res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
        return res.end(body);
      }
      res.writeHead(404).end("not found");
      return undefined;
    } catch {
      if (res.headersSent) {
        res.destroy();
      } else {
        res.writeHead(500).end("error");
      }
      return undefined;
    }
  })();
});

attachWsTransport(server, host); // default: networked clients can read + park, never confirm
server.listen(PORT, () => {
  console.log(
    `\nOperational workspace demo (${useReal ? "REAL officecli" : "fake officecli double"})`,
  );
  console.log(`  board (networked):  http://localhost:${PORT}/`);
  console.log(`  operator console:   http://localhost:${PORT}/operator`);
  console.log(
    `\nApprove the grant in the operator console, then the table fills and the action button works.\n`,
  );
});
