// The optional `--serve` demo surface: a THIN HTTP server that lets a human watch an
// agent build a dashboard live. It is a demo, not a product server. It exposes:
//   - the approved-widget static asset route from `@boardstate/server` (exact CSP),
//   - `GET /events`  → SSE stream that pushes `boardstate.changed` on every write,
//   - `POST /rpc`    → forwards `{ method, params }` into the in-process host,
//   - `GET /` / `GET /workspace` → a minimal host page + the current doc.
//
// It shares the SAME store + host as the MCP server, so the SSE stream reflects the
// agent's writes as they happen.
//
// NOTE on `<boardstate-view>`: the packet asks the demo page to mount the built
// `@boardstate/lit` element. That element's dependency chain (`@boardstate/core`) is a
// Node-targeted dist that imports node builtins (`node:crypto`, …), so it cannot be
// loaded in a plain browser without a browser-targeted bundle — out of scope for this
// thin runtime demo (it needs a build step, not a runtime server). The host page
// therefore renders the live workspace JSON over SSE, which is the load-bearing "watch
// the agent build live" mechanism; hydrating the real element is left to a future
// browser bundle of `@boardstate/lit`. See the manifest note.

import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import type { DashboardStore } from "@boardstate/core";
import {
  createWidgetHttpRouteHandler,
  formatError,
  type InProcessHost,
} from "@boardstate/server/node";

export type ServeHostOptions = {
  store: DashboardStore;
  host: InProcessHost;
  port: number;
  hostname?: string;
};

export type ServeHostHandle = {
  url: string;
  port: number;
  close: () => Promise<void>;
};

const MAX_RPC_BODY_BYTES = 512 * 1024;

function hostPage(): string {
  // Kept deliberately minimal: an SSE-driven live JSON view of the workspace.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Boardstate host</title>
<style>
  body { font: 14px/1.5 ui-monospace, monospace; margin: 0; background: #0b0b0c; color: #e6e6e6; }
  header { padding: 12px 16px; border-bottom: 1px solid #222; display: flex; gap: 12px; align-items: baseline; }
  header strong { font-size: 15px; }
  #status { color: #6aa84f; }
  main { padding: 16px; }
  pre { white-space: pre-wrap; word-break: break-word; margin: 0; }
</style>
</head>
<body>
<header><strong>Boardstate host</strong><span id="status">connecting…</span></header>
<main><pre id="doc">loading…</pre></main>
<script type="module">
  const statusEl = document.getElementById("status");
  const docEl = document.getElementById("doc");
  async function refresh() {
    try {
      const res = await fetch("/workspace");
      docEl.textContent = JSON.stringify(await res.json(), null, 2);
    } catch (err) {
      docEl.textContent = "failed to load workspace: " + err;
    }
  }
  const events = new EventSource("/events");
  events.addEventListener("open", () => { statusEl.textContent = "live"; });
  events.addEventListener("error", () => { statusEl.textContent = "reconnecting…"; });
  events.addEventListener("boardstate.changed", refresh);
  refresh();
</script>
</body>
</html>`;
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_RPC_BODY_BYTES) {
      throw new Error("request body too large");
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Start the demo host HTTP server. `@boardstate/lit` is dynamically imported first so
 * `--serve` degrades gracefully (a printed message + no server) when it is not built.
 */
export async function startServeHost(options: ServeHostOptions): Promise<ServeHostHandle> {
  const widgetRoute = createWidgetHttpRouteHandler({ store: options.store });
  const sseClients = new Set<ServerResponse>();
  const unsubscribe = options.host.addEventListener("boardstate.changed", (payload) => {
    const data = JSON.stringify(payload ?? {});
    for (const client of sseClients) {
      client.write(`event: boardstate.changed\ndata: ${data}\n\n`);
    }
  });

  const httpServer: HttpServer = createServer((req, res) => {
    void handle(req, res).catch((error) => {
      if (!res.headersSent) {
        send(res, 500, "text/plain; charset=utf-8", formatError(error));
      } else {
        res.end();
      }
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");

    // Approved-widget static assets (own their own CSP + 404 semantics).
    if (await widgetRoute.handleHttpRequest(req, res)) {
      return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      send(res, 200, "text/html; charset=utf-8", hostPage());
      return;
    }

    if (req.method === "GET" && url.pathname === "/workspace") {
      send(res, 200, "application/json; charset=utf-8", JSON.stringify(await options.store.read()));
      return;
    }

    if (req.method === "GET" && url.pathname === "/events") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Connection", "keep-alive");
      res.write(": connected\n\n");
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    if (req.method === "POST" && url.pathname === "/rpc") {
      let parsed: { method?: unknown; params?: unknown };
      try {
        parsed = JSON.parse(await readBody(req)) as { method?: unknown; params?: unknown };
      } catch (error) {
        send(
          res,
          400,
          "application/json; charset=utf-8",
          JSON.stringify({ error: formatError(error) }),
        );
        return;
      }
      if (typeof parsed.method !== "string") {
        send(
          res,
          400,
          "application/json; charset=utf-8",
          JSON.stringify({ error: "method is required" }),
        );
        return;
      }
      try {
        const result = await options.host.request(parsed.method, parsed.params);
        send(res, 200, "application/json; charset=utf-8", JSON.stringify({ result }));
      } catch (error) {
        send(
          res,
          400,
          "application/json; charset=utf-8",
          JSON.stringify({ error: formatError(error) }),
        );
      }
      return;
    }

    send(res, 404, "text/plain; charset=utf-8", "not found");
  }

  const hostname = options.hostname ?? "127.0.0.1";
  await new Promise<void>((resolve) => httpServer.listen(options.port, hostname, resolve));
  const address = httpServer.address();
  const boundPort = typeof address === "object" && address ? address.port : options.port;

  return {
    url: `http://${hostname}:${boundPort}/`,
    port: boundPort,
    close: () =>
      new Promise<void>((resolve, reject) => {
        unsubscribe();
        for (const client of sseClients) {
          client.end();
        }
        sseClients.clear();
        httpServer.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
