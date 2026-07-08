// Content for the ONE custom widget the "simulate agent" script scaffolds.
//
// A real host writes this to disk (@boardstate/server's scaffoldDashboardWidget)
// and serves it over HTTP (serve.ts, SPEC §9). This standalone example has no
// server process, so the same two files (widget.json + index.html) are built here
// as strings and handed to the mini-loader (src/widget-loader.ts), which answers
// the exact same `/widgets/<name>/<file>` requests `@boardstate/lit`'s unmodified
// custom-widget host already issues (widgetAssetUrl + fetch). See widget-loader.ts
// for the serving mechanism and its documented divergence from serve.ts.
//
// The bridge handshake below (post ready → getData → render on data/push, apply
// theme) is the same v1 protocol every template in `templates/widgets/` uses.

export const DEMO_WIDGET_NAME = "agent-insight-card";
export const DEMO_WIDGET_TITLE = "Agent Insight Card";
export const DEMO_WIDGET_BINDING_ID = "value";

export type DemoWidgetValue = { headline: string; detail: string; count: number };

export const DEMO_WIDGET_VALUE: DemoWidgetValue = {
  headline: "Sandboxed & approved",
  detail:
    "An agent scaffolded this widget and it only started rendering the moment you clicked Approve.",
  count: 1,
};

/** `widget.json` (SPEC §8.1) — mirrors @boardstate/server's scaffold shape. */
export function buildDemoWidgetManifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name: DEMO_WIDGET_NAME,
    title: DEMO_WIDGET_TITLE,
    entrypoint: "index.html",
    bindings: [{ id: DEMO_WIDGET_BINDING_ID, source: "static", value: DEMO_WIDGET_VALUE }],
    capabilities: ["data:read"],
    preferredSize: { w: 6, h: 4 },
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** `index.html` — the sandboxed widget body. Zero external requests, v1 bridge only. */
export function buildDemoWidgetHtml(createdBy: string): string {
  const title = escapeHtml(DEMO_WIDGET_TITLE);
  const bindingId = DEMO_WIDGET_BINDING_ID;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: light dark; --wg-bg: Canvas; --wg-card: Canvas; --wg-text: CanvasText;
      --wg-accent: #6366f1; --wg-border: rgba(127,127,127,0.3); }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 16px; font-family: var(--font-sans, system-ui, sans-serif);
      background: var(--wg-bg); color: var(--wg-text); }
    .card { border: 1px solid var(--wg-border); border-radius: 10px; padding: 14px 16px;
      background: var(--wg-card); }
    .badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11px;
      font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase;
      color: var(--wg-accent); }
    .badge::before { content: ""; width: 6px; height: 6px; border-radius: 999px;
      background: var(--wg-accent); }
    h1 { margin: 10px 0 6px; font-size: 1.05rem; }
    p { margin: 0; opacity: 0.85; line-height: 1.4; }
    .count { margin-top: 12px; font-size: 1.6rem; font-weight: 700; color: var(--wg-accent); }
    footer { margin-top: 14px; font-size: 0.72rem; opacity: 0.6; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge" id="badge">Loading</span>
    <h1 id="headline">Waiting for dashboard data…</h1>
    <p id="detail"></p>
    <div class="count" id="count"></div>
  </div>
  <footer>Built by ${escapeHtml(createdBy)} · runs sandboxed, no network</footer>
  <script>
    var headlineNode = document.getElementById("headline");
    var detailNode = document.getElementById("detail");
    var countNode = document.getElementById("count");
    var badgeNode = document.getElementById("badge");

    function post(type, payload) {
      window.parent.postMessage(Object.assign({ v: 1, type: type }, payload || {}), "*");
    }

    function render(data) {
      if (data && typeof data === "object") {
        headlineNode.textContent = typeof data.headline === "string" ? data.headline : "";
        detailNode.textContent = typeof data.detail === "string" ? data.detail : "";
        countNode.textContent = typeof data.count === "number" ? String(data.count) : "";
      } else {
        headlineNode.textContent = typeof data === "string" ? data : JSON.stringify(data);
      }
      badgeNode.textContent = "Live";
    }

    function applyTheme(tokens) {
      var root = document.documentElement.style;
      if (tokens["--bg"]) root.setProperty("--wg-bg", tokens["--bg"]);
      if (tokens["--card"]) root.setProperty("--wg-card", tokens["--card"]);
      if (tokens["--text"]) root.setProperty("--wg-text", tokens["--text"]);
      if (tokens["--accent"]) root.setProperty("--wg-accent", tokens["--accent"]);
      if (tokens["--border"]) root.setProperty("--wg-border", tokens["--border"]);
    }

    window.addEventListener("message", function (event) {
      var msg = event.data;
      if (!msg || msg.v !== 1) return;
      if (
        (msg.type === "dashboard:data" || msg.type === "dashboard:push") &&
        msg.bindingId === "${bindingId}"
      ) {
        render(msg.data);
      } else if (msg.type === "dashboard:theme") {
        applyTheme(msg.tokens || {});
      } else if (msg.type === "dashboard:error") {
        badgeNode.textContent = "Error";
        headlineNode.textContent = msg.code + ": " + msg.message;
      }
    });

    post("dashboard:ready");
    post("dashboard:getData", { requestId: "initial", bindingId: "${bindingId}" });
    post("dashboard:getTheme", { requestId: "theme" });
  </script>
</body>
</html>
`;
}
