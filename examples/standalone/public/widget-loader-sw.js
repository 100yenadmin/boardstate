// Mini-loader Service Worker for the standalone example.
//
// @boardstate/server's `serve.ts` answers `GET /widgets/<name>/<file>` from real
// files on disk (SPEC §9), with a locked-down header set on every response. This
// example runs with NO server process — `@boardstate/lit`'s custom-widget host is
// UNMODIFIED and still computes that exact same relative URL
// (`widgetAssetUrl(basePath, name, file)`) for both the manifest `fetch()` and the
// sandboxed iframe's `src` navigation. This worker intercepts same-origin requests
// under `/widgets/` and answers them from Blobs registered by the page
// (src/widget-loader.ts), so the unmodified fetch + iframe-navigation code paths
// both resolve without any server.
//
// Divergence from serve.ts (noted for the orchestrator): no filesystem, no path
// jail / symlink re-check (there is no filesystem to escape from — content is
// register-only, in-memory Blobs the page itself constructed), and only exact
// registered pathnames are served (no directory listing, no traversal surface at
// all). The response headers below are otherwise IDENTICAL to WIDGET_CSP in
// packages/server/src/serve.ts, kept in sync by hand (this worker cannot import
// from the package graph).

const WIDGET_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self' data:; connect-src 'none'; frame-ancestors 'self'";

/** pathname -> { body: Blob | string, contentType: string } */
const files = new Map();

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of any already-open page immediately — no reload required
  // before the very first "simulate agent" click can register + serve content.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "widget-loader:register") {
    return;
  }
  for (const file of data.files) {
    files.set(file.pathname, { body: file.body, contentType: file.contentType });
  }
  event.source?.postMessage({ type: "widget-loader:registered", requestId: data.requestId });
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const entry = files.get(url.pathname);
  if (!entry) {
    // Not one of our registered demo-widget paths — fall through to the network
    // untouched (the app's own JS/CSS, HMR client, etc.).
    return;
  }
  event.respondWith(
    new Response(entry.body, {
      status: 200,
      headers: {
        "Content-Type": entry.contentType,
        "Content-Security-Policy": WIDGET_CSP,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
      },
    }),
  );
});
