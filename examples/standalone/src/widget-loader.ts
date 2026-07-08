// Page-side glue for public/widget-loader-sw.js — see that file for why a Service
// Worker stands in for @boardstate/server's serve.ts in this no-backend example.

const SW_URL = "/widget-loader-sw.js";

export type WidgetFile = { pathname: string; body: Blob | string; contentType: string };

let readyPromise: Promise<boolean> | null = null;

/**
 * Register the mini-loader worker and wait until it can actually serve a request
 * for THIS page load (not just "installed" — `activate`'s `clients.claim()` must
 * have taken effect). Resolves `false` when Service Workers are unavailable
 * (unsupported browser, insecure context); callers degrade gracefully rather than
 * hang the demo.
 */
export function ensureWidgetLoaderReady(): Promise<boolean> {
  if (readyPromise) {
    return readyPromise;
  }
  readyPromise = (async () => {
    if (!("serviceWorker" in navigator)) {
      return false;
    }
    try {
      await navigator.serviceWorker.register(SW_URL);
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        // First-ever registration on this page load: wait for clients.claim() to
        // take effect, with a short safety timeout so a slow/odd browser can never
        // hang the "simulate agent" button forever.
        await new Promise<void>((resolve) => {
          const onChange = () => {
            navigator.serviceWorker.removeEventListener("controllerchange", onChange);
            resolve();
          };
          navigator.serviceWorker.addEventListener("controllerchange", onChange);
          setTimeout(resolve, 1500);
        });
      }
      return navigator.serviceWorker.controller !== null;
    } catch {
      return false;
    }
  })();
  return readyPromise;
}

/**
 * Hand the mini-loader Blobs for the custom widget's assets, resolving once the
 * worker has acknowledged registration (or after a short timeout, so a dropped
 * message can never hang the demo).
 */
export function publishWidgetFiles(files: WidgetFile[]): Promise<void> {
  const controller = navigator.serviceWorker.controller;
  if (!controller) {
    return Promise.resolve();
  }
  const requestId = crypto.randomUUID();
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) {
        return;
      }
      settled = true;
      navigator.serviceWorker.removeEventListener("message", onMessage);
      resolve();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "widget-loader:registered" && event.data.requestId === requestId) {
        done();
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    controller.postMessage({ type: "widget-loader:register", requestId, files });
    setTimeout(done, 800);
  });
}
