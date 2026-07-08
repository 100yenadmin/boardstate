// HTTP route adapter for serving approved custom-widget assets (SPEC §9).
//
// Registered as an unauthenticated route because sandboxed iframes carry no
// credential — safe ONLY because `serveWidgetAsset` is static-file only. This
// adapter just turns the node request into `{ method, pathname }` and delegates;
// all jail/gate/header logic lives in `serve.ts`.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { DashboardStore } from "@boardstate/core";
import type { NodeHttpHandler } from "./host.js";
import { serveWidgetAsset, WIDGETS_ROUTE_PREFIX } from "./serve.js";

export { WIDGETS_ROUTE_PREFIX };

/** Creates the HTTP route handler bound to the shared dashboard store. */
export function createWidgetHttpRouteHandler(params: {
  store: DashboardStore;
  stateDir?: string;
}): NodeHttpHandler {
  return {
    async handleHttpRequest(req: IncomingMessage, res: ServerResponse) {
      const url = new URL(req.url ?? "/", "http://localhost");
      return await serveWidgetAsset({ method: req.method, pathname: url.pathname }, res, {
        store: params.store,
        ...(params.stateDir ? { stateDir: params.stateDir } : {}),
      });
    },
  };
}
