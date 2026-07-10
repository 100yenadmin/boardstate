// The in-iframe half of the MCP Apps board view (SEP-1865, SPEC-adjacent — see
// issue #26): runs INSIDE the host's sandboxed iframe, connects the ext-apps bridge
// (postMessage JSON-RPC to the host), and mounts the REAL `<boardstate-view>` with a
// Transport that maps `dashboard.*` requests onto `tools/call boardstate_*` — the
// same control plane every other face drives, over the only channel the sandbox has.
//
// Bundled self-contained by tsdown (`board-app-client` entry, browser platform,
// everything inlined) and embedded into the `ui://boardstate/board.html` resource by
// apps.ts — the host CSP is deny-by-default for network, so the resource must carry
// every byte it needs.

import { App } from "@modelcontextprotocol/ext-apps";
import "@boardstate/lit/browser";

/** `dashboard.*` methods with a 1:1 `boardstate_*` tool (the MCP face's coverage). */
const METHOD_TO_TOOL: Record<string, string> = {
  "dashboard.workspace.get": "boardstate_workspace_get",
  "dashboard.workspace.replace": "boardstate_workspace_replace",
  "dashboard.workspace.undo": "boardstate_undo",
  "dashboard.tab.create": "boardstate_tab_create",
  "dashboard.tab.update": "boardstate_tab_update",
  "dashboard.tab.delete": "boardstate_tab_delete",
  "dashboard.tab.reorder": "boardstate_tabs_reorder",
  "dashboard.widget.add": "boardstate_widget_add",
  "dashboard.widget.update": "boardstate_widget_update",
  "dashboard.widget.move": "boardstate_widget_move",
  "dashboard.widget.remove": "boardstate_widget_remove",
  "dashboard.layout.set": "boardstate_layout_set",
};

/** The widget_add/update tools take the widget/patch fields FLAT next to tab/id. */
function flattenParams(method: string, params: unknown): Record<string, unknown> {
  const record = (params ?? {}) as Record<string, unknown>;
  if (method === "dashboard.widget.add" && typeof record.widget === "object") {
    const { widget, actor: _actor, ...rest } = record;
    return { ...rest, ...(widget as Record<string, unknown>) };
  }
  if (method === "dashboard.widget.update" && typeof record.patch === "object") {
    const { patch, actor: _actor, ...rest } = record;
    return { ...rest, ...(patch as Record<string, unknown>) };
  }
  const { actor: _actor, ...rest } = record;
  return rest;
}

function parseToolResult(result: {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
}): unknown {
  const text = result.content?.find((entry) => entry.type === "text")?.text;
  const payload = text ? (JSON.parse(text) as unknown) : {};
  if (result.isError) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as { error: unknown }).error)
        : "tool call failed";
    throw new Error(message);
  }
  return payload;
}

async function main(): Promise<void> {
  const app = new App({ name: "boardstate-board", version: "1.0.0" }, {});
  await app.connect();

  // Poll-based change fan-out: the bridge has no host-event channel for our
  // broadcasts, so listeners for `boardstate.changed` are fed by a version poll.
  // Kept slow (2.5s) — a mutation through THIS view refreshes immediately anyway.
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  let lastVersion = -1;

  const request = async (method: string, params?: unknown): Promise<unknown> => {
    const tool = METHOD_TO_TOOL[method];
    if (!tool) {
      throw new Error(`not available in the MCP Apps view: ${method}`);
    }
    const result = await app.callServerTool({
      name: tool,
      arguments: flattenParams(method, params),
    });
    const payload = parseToolResult(result as never) as { workspaceVersion?: number };
    if (typeof payload?.workspaceVersion === "number") {
      lastVersion = payload.workspaceVersion;
    }
    return payload;
  };

  const transport = {
    request,
    addEventListener(event: string, fn: (payload: unknown) => void): () => void {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(fn);
      return () => {
        set?.delete(fn);
      };
    },
  };

  setInterval(() => {
    void (async () => {
      try {
        const payload = (await request("dashboard.workspace.get")) as {
          workspaceVersion?: number;
        };
        const version = payload?.workspaceVersion ?? -1;
        if (version !== lastVersion) {
          lastVersion = version;
          for (const fn of listeners.get("boardstate.changed") ?? []) {
            fn({ workspaceVersion: version });
          }
        }
      } catch {
        // A failed poll skips the tick; the next one retries.
      }
    })();
  }, 2500);

  const view = document.createElement("boardstate-view") as HTMLElement & {
    transport: unknown;
    connected: boolean;
  };
  view.transport = transport;
  view.connected = true;
  document.getElementById("app")?.appendChild(view);
}

void main();
