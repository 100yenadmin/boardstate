// MCP rig: serve a RENDERED <boardstate-view> against a SHARED state dir
// while a real Claude (headless CLI, separate process) drives its own stdio MCP
// server on the same dir. fs.watch bridges cross-process writes → SSE → the view
// refetches live. Packages served from their built dists; lit via esm.sh.
import { watch, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { join, extname, normalize } from "node:path";

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STATE_DIR = process.env.RIG_STATE_DIR ?? "/tmp/boardstate-rig-state";
const PORT = Number(process.env.RIG_PORT ?? 4400);

mkdirSync(join(STATE_DIR, "dashboard"), { recursive: true });
const wsPath = join(STATE_DIR, "dashboard", "workspace.json");
if (!existsSync(wsPath)) {
  writeFileSync(
    wsPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        workspaceVersion: 1,
        tabs: [
          {
            slug: "home",
            title: "Home",
            hidden: false,
            createdBy: "system",
            widgets: [
              {
                id: "hello",
                kind: "builtin:markdown",
                title: "Welcome",
                grid: { x: 3, y: 0, w: 6, h: 3 },
                collapsed: false,
                hidden: false,
                bindings: {
                  value: {
                    source: "static",
                    value:
                      "### This board is empty\n\nA real **Claude** is connected over **MCP** and about to build it — watch.",
                  },
                },
              },
            ],
          },
        ],
        widgetsRegistry: {},
        prefs: { tabOrder: ["home"] },
      },
      null,
      2,
    ) + "\n",
  );
}

const LIT_CDN = "https://esm.sh/lit@3.3.3";
const PAGE = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8"><title>Boardstate — live (MCP)</title>
<link rel="stylesheet" href="/pkg/lit/styles.css">
<script type="importmap">
{"imports":{
  "@boardstate/schema":"/pkg/schema/index.js",
  "@boardstate/core":"/pkg/core/index.js",
  "@boardstate/host":"/pkg/host/index.js",
  "lit":"${LIT_CDN}",
  "lit/async-directive.js":"${LIT_CDN}/async-directive.js",
  "lit/directive.js":"${LIT_CDN}/directive.js",
  "lit/directives/ref.js":"${LIT_CDN}/directives/ref.js",
  "lit/directives/unsafe-html.js":"${LIT_CDN}/directives/unsafe-html.js"
}}
</script>
<style>
  body { margin:0; background: var(--bs-bg,#0b0b0f); color: var(--bs-text,#ededf2);
    font-family: -apple-system, system-ui, sans-serif; }
  header { display:flex; align-items:center; gap:10px; padding: 12px 20px;
    border-bottom:1px solid var(--bs-border,#23232b); background: var(--bs-card,#131318); }
  header b { font-size: 15px; } header .live { color:#3fb950; font-size:12px; font-weight:700;
    text-transform:uppercase; letter-spacing:.05em; }
  header .sub { color: var(--bs-text-muted,#9a9aa6); font-size: 13px; }
  #app { padding: 16px 20px; }
</style>
</head>
<body>
<header><b>Boardstate</b><span class="live">● live</span>
<span class="sub">a real Claude is editing this board over MCP — no human hands</span></header>
<div id="app"></div>
<script type="module">
  import "/pkg/lit/index.js";
  const transport = {
    async request(method, params) {
      if (method === "dashboard.workspace.get") {
        const doc = await (await fetch("/workspace")).json();
        return { doc, workspaceVersion: doc.workspaceVersion };
      }
      if (method === "chat.history.get") return { events: [] };
      throw new Error("read-only video host: " + method);
    },
    addEventListener(event, fn) {
      const es = new EventSource("/events");
      es.addEventListener("boardstate.changed", (e) => fn(JSON.parse(e.data)));
      return () => es.close();
    },
  };
  const view = document.createElement("boardstate-view");
  view.transport = transport;
  view.connected = true;
  document.getElementById("app").appendChild(view);
</script>
</body>
</html>`;

const MIME = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
};
const PKG_ROOTS = {
  schema: join(REPO, "packages/schema/dist"),
  core: join(REPO, "packages/core/dist"),
  host: join(REPO, "packages/host/dist"),
  lit: join(REPO, "packages/lit/dist"),
};

const sseClients = new Set();
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;
  try {
    if (p === "/" || p === "/view") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(PAGE);
    }
    if (p === "/workspace") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(readFileSync(wsPath, "utf8"));
    }
    if (p === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }
    if (p === "/pkg/lit/styles.css") {
      res.writeHead(200, { "Content-Type": MIME[".css"] });
      return res.end(readFileSync(join(REPO, "packages/lit/src/styles/boardstate.css")));
    }
    const m = p.match(/^\/pkg\/(schema|core|host|lit)\/(.+)$/);
    if (m) {
      const root = PKG_ROOTS[m[1]];
      const file = normalize(join(root, m[2]));
      if (!file.startsWith(root)) throw new Error("traversal");
      res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
      return res.end(readFileSync(file));
    }
    res.writeHead(404).end("not found");
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
});
server.listen(PORT, () => console.log(`rendered host: http://localhost:${PORT}/view`));

let last = "";
watch(join(STATE_DIR, "dashboard"), { persistent: true }, () => {
  try {
    const raw = readFileSync(wsPath, "utf8");
    if (raw === last) return;
    last = raw;
    const doc = JSON.parse(raw);
    const data = JSON.stringify({ workspaceVersion: doc.workspaceVersion, actor: "agent:claude" });
    for (const c of sseClients) c.write(`event: boardstate.changed\ndata: ${data}\n\n`);
  } catch {
    /* mid-write */
  }
});
