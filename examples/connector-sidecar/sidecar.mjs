// The reference REAL-DATA connector (SPEC §16, M4c): a ~150-line Node sidecar that
// serves a live Boardstate board of THIS MACHINE's actual metrics — memory + load,
// sampled every second — to any browser over the networked WebSocket transport.
//
//   node examples/connector-sidecar/sidecar.mjs      # then open http://localhost:4600
//
// What it demonstrates, end to end:
//   1. `installConnector` (@boardstate/server) — the host connector contract:
//      an allowlisted read (`health`) + an allowlisted stream (`presence`) carrying
//      real, changing data. Widgets bind `{ source: "stream", event: "presence",
//      pointer: "/ticker/…" }` and tick live; no polling, no custom sockets in core.
//   2. `attachWsTransport` (@boardstate/server/node) — the out-of-process seam:
//      the browser board drives this host over one WebSocket.
//   3. `@boardstate/lit/browser` — the self-contained bundle: the page below needs
//      an import map for schema/core only (for `createWsTransport`).
//
// Everything here is USERLAND: no core changes, and every name is allowlist-gated
// three times (registration here, schema at write time, client at subscribe time).

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, normalize, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadavg } from "node:os";
// Relative dist imports so `node examples/connector-sidecar/sidecar.mjs` works from
// a repo checkout without a package.json here (published-package users import the
// bare names instead — see docs/connectors.md).
import { MemoryStorageAdapter, DashboardStore } from "../../packages/core/dist/index.js";
import {
  attachWsTransport,
  createInProcessHost,
  installConnector,
  nodeRpcDeps,
  registerBoardstateRpc,
} from "../../packages/server/dist/node.js";

const PORT = Number(process.env.PORT ?? 4600);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ---- the host (same in-process host every other face drives) -----------------
const storage = new MemoryStorageAdapter();
const store = new DashboardStore({ storage });
const host = createInProcessHost(store, storage);
registerBoardstateRpc(host, { store, ...nodeRpcDeps() });

// ---- the connector: REAL machine metrics --------------------------------------
const series = [];
function sample() {
  const memory = process.memoryUsage();
  const rssMb = Math.round((memory.rss / 1024 / 1024) * 10) / 10;
  series.push(rssMb);
  if (series.length > 30) {
    series.shift();
  }
  return {
    ticker: {
      rssMb,
      heapMb: Math.round((memory.heapUsed / 1024 / 1024) * 10) / 10,
      load1: Math.round(loadavg()[0] * 100) / 100,
      series: [...series],
    },
  };
}

installConnector(host, {
  reads: {
    health: () => ({ ok: true, uptimeSec: Math.round(process.uptime()) }),
  },
  streams: [{ event: "presence", intervalMs: 1000, payload: sample }],
});

// ---- the board (stream + rpc bindings over that connector) --------------------
await host.request("dashboard.workspace.replace", {
  actor: "user",
  doc: {
    schemaVersion: 1,
    workspaceVersion: 1,
    prefs: { tabOrder: ["machine"] },
    widgetsRegistry: {},
    tabs: [
      {
        slug: "machine",
        title: "This machine",
        hidden: false,
        createdBy: "system",
        widgets: [
          {
            id: "rss",
            kind: "builtin:stat-card",
            title: "RSS",
            grid: { x: 0, y: 0, w: 4, h: 2 },
            collapsed: false,
            hidden: false,
            bindings: { value: { source: "stream", event: "presence", pointer: "/ticker/rssMb" } },
            props: { label: "resident memory (MB)" },
          },
          {
            id: "heap",
            kind: "builtin:stat-card",
            title: "Heap",
            grid: { x: 4, y: 0, w: 4, h: 2 },
            collapsed: false,
            hidden: false,
            bindings: { value: { source: "stream", event: "presence", pointer: "/ticker/heapMb" } },
            props: { label: "heap used (MB)" },
          },
          {
            id: "load",
            kind: "builtin:stat-card",
            title: "Load",
            grid: { x: 8, y: 0, w: 4, h: 2 },
            collapsed: false,
            hidden: false,
            bindings: { value: { source: "stream", event: "presence", pointer: "/ticker/load1" } },
            props: { label: "1-min load average" },
          },
          {
            id: "trend",
            kind: "builtin:chart",
            title: "RSS trend (30s)",
            grid: { x: 0, y: 2, w: 8, h: 5 },
            collapsed: false,
            hidden: false,
            bindings: { value: { source: "stream", event: "presence", pointer: "/ticker/series" } },
            props: { type: "area" },
          },
          {
            id: "about",
            kind: "builtin:markdown",
            title: "What you're looking at",
            grid: { x: 8, y: 2, w: 4, h: 5 },
            collapsed: false,
            hidden: false,
            props: {
              markdown:
                "**Real data, three layers:**\n\n1. `installConnector` broadcasts this process's memory + load every second\n2. `attachWsTransport` carries it over ONE WebSocket\n3. the widgets' `stream` bindings re-render per push\n\n_Same control plane an agent drives._",
            },
          },
        ],
      },
    ],
  },
});

// ---- the page: lit browser bundle + the real WS transport ---------------------
const PAGE = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8"><title>Boardstate — this machine, live</title>
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

const PKG_ROOTS = {
  schema: join(ROOT, "packages/schema/dist"),
  core: join(ROOT, "packages/core/dist"),
  lit: join(ROOT, "packages/lit/dist"),
};
const MIME = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  try {
    if (pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(PAGE);
    }
    if (pathname === "/pkg/lit/styles.css") {
      // Read BEFORE writeHead — a throw after headers are sent cannot 500 cleanly.
      const css = readFileSync(join(PKG_ROOTS.lit, "styles.css"));
      res.writeHead(200, { "Content-Type": MIME[".css"] });
      return res.end(css);
    }
    const match = pathname.match(/^\/pkg\/(schema|core|lit)\/(.+)$/);
    if (match) {
      const root = PKG_ROOTS[match[1]];
      const file = normalize(join(root, match[2]));
      if (!file.startsWith(root)) {
        throw new Error("traversal");
      }
      const body = readFileSync(file);
      res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
      return res.end(body);
    }
    res.writeHead(404).end("not found");
  } catch {
    if (res.headersSent) {
      res.destroy();
    } else {
      res.writeHead(500).end("error");
    }
  }
});

attachWsTransport(server, host);
server.listen(PORT, () => {
  console.log(`machine board: http://localhost:${PORT}  (WS transport on /ws)`);
});
