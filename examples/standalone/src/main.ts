// Boardstate standalone example — a full dashboard host running ENTIRELY in the
// browser: no server process. The in-process host (`@boardstate/server`) runs over
// `MemoryStorageAdapter`, and `<boardstate-view>` (`@boardstate/lit`) renders it.
// This is the proof that the library is genuinely headless + browser-capable.
//
// Custom widgets normally load their assets over `@boardstate/server`'s static
// route (SPEC §9). With no server here, a Service Worker (public/widget-loader-sw.js)
// answers the exact `/widgets/<name>/<file>` requests lit's unmodified custom-widget
// host issues — same CSP, same approval gate, no backend.

import { DashboardStore, MemoryStorageAdapter, type WorkspaceDoc } from "@boardstate/core";
import { createInProcessHost, registerBoardstateRpc } from "@boardstate/server";
import "@boardstate/lit";
// The view renders to light DOM, so its stylesheet (grid, cells, tokens) loads here.
import "@boardstate/lit/styles.css";
import agentHq from "../../../templates/agent-hq.json";
import { ensureWidgetLoaderReady, publishWidgetFiles } from "./widget-loader.js";
import {
  DEMO_WIDGET_BINDING_ID,
  DEMO_WIDGET_NAME,
  DEMO_WIDGET_TITLE,
  DEMO_WIDGET_VALUE,
  buildDemoWidgetHtml,
  buildDemoWidgetManifest,
} from "./demo-widget-content.js";

const SIM_AGENT = "agent:sales-bot";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const storage = new MemoryStorageAdapter();
  const store = new DashboardStore({ storage });
  const host = createInProcessHost(store, storage);
  registerBoardstateRpc(host, { store });

  // Seed the "Agent HQ" template so the board looks composed on first paint.
  await host.request("dashboard.workspace.replace", {
    doc: agentHq as WorkspaceDoc,
    actor: "user",
  });

  const view = document.createElement("boardstate-view") as HTMLElement & {
    transport?: unknown;
    connected?: boolean;
    basePath?: string;
  };
  view.transport = host;
  view.connected = true;
  view.basePath = "";
  document.getElementById("app")!.appendChild(view);

  // The custom-widget loader (Service Worker) is only needed once the simulate flow
  // mounts a custom widget — warm it up in the background, never blocking first paint.
  void ensureWidgetLoaderReady().catch(() => undefined);

  wireSimulateButton(host);
}

/** The scripted "an agent builds a dashboard" flow, over the SAME transport a human uses. */
function wireSimulateButton(host: ReturnType<typeof createInProcessHost>): void {
  const btn = document.getElementById("simulate") as HTMLButtonElement;
  const status = document.getElementById("status")!;
  const say = (msg: string) => {
    status.textContent = msg;
  };
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      say("🤖 creating a “Sales” tab…");
      await host.request("dashboard.tab.create", {
        slug: "sales",
        title: "Sales",
        actor: SIM_AGENT,
      });
      await sleep(700);

      say("🤖 adding a live chart…");
      await host.request("dashboard.widget.add", {
        tab: "sales",
        actor: SIM_AGENT,
        widget: {
          id: "sales-trend",
          kind: "builtin:chart",
          title: "Weekly revenue",
          grid: { x: 0, y: 0, w: 6, h: 3 },
          props: { type: "area" },
          bindings: { value: { source: "static", value: [12, 18, 15, 24, 30, 28, 36] } },
        },
      });
      await sleep(700);

      say("🤖 scaffolding a custom widget… (it lands PENDING — needs your approval)");
      await publishWidgetFiles([
        {
          pathname: `/widgets/${DEMO_WIDGET_NAME}/widget.json`,
          body: JSON.stringify(buildDemoWidgetManifest()),
          contentType: "application/json",
        },
        {
          pathname: `/widgets/${DEMO_WIDGET_NAME}/index.html`,
          body: buildDemoWidgetHtml(SIM_AGENT),
          contentType: "text/html",
        },
      ]);
      const doc = ((await host.request("dashboard.workspace.get")) as { doc: WorkspaceDoc }).doc;
      const sales = doc.tabs.find((tab) => tab.slug === "sales")!;
      sales.widgets.push({
        id: "insight-1",
        kind: `custom:${DEMO_WIDGET_NAME}`,
        title: DEMO_WIDGET_TITLE,
        grid: { x: 6, y: 0, w: 6, h: 3 },
        collapsed: false,
        hidden: false,
        bindings: { [DEMO_WIDGET_BINDING_ID]: { source: "static", value: DEMO_WIDGET_VALUE } },
      });
      doc.widgetsRegistry[DEMO_WIDGET_NAME] = { status: "pending", createdBy: SIM_AGENT };
      await host.request("dashboard.workspace.replace", { doc, actor: SIM_AGENT });
      say("👤 a pending-approval card appeared — approving it (as the operator)…");
      await sleep(1600);

      say("✅ approved — the sandboxed widget mounts and renders live.");
      await host.request("dashboard.widget.approve", {
        name: DEMO_WIDGET_NAME,
        decision: "approved",
        actor: "user",
      });
    } catch (error) {
      say(`error: ${String(error)}`);
    } finally {
      btn.disabled = false;
    }
  });
}

void main();
