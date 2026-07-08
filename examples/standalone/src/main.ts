// Boardstate standalone example — a full dashboard host running ENTIRELY in the
// browser: no server process. The in-process host (`@boardstate/server`) runs over
// `MemoryStorageAdapter`, and `<boardstate-view>` (`@boardstate/lit`) renders it.
// This is the proof that the library is genuinely headless + browser-capable.
//
// Custom widgets normally load their assets over `@boardstate/server`'s static
// route (SPEC §9). With no server here, the demo widget's two files live as
// static assets (public/widgets/agent-insight-card/), served by Vite / any
// static host at the exact `/widgets/<name>/<file>` paths lit's unmodified
// custom-widget host requests — including the sandboxed iframe's own document
// navigation, which no Service Worker can intercept for an opaque-origin frame.

import { DashboardStore, MemoryStorageAdapter, type WorkspaceDoc } from "@boardstate/core";
import { createInProcessHost, registerBoardstateRpc } from "@boardstate/server";
import "@boardstate/lit";
// The view renders to light DOM, so its stylesheet (grid, cells, tokens) loads here.
// This ships the default "Graphite" theme (light + dark) out of the box.
import "@boardstate/lit/styles.css";
// Alternate themes layer over the base — imported as URLs so the switcher can
// attach/detach them at runtime (the same drop-in a consumer would ship).
import auroraThemeUrl from "@boardstate/lit/themes/aurora.css?url";
import vibrancyThemeUrl from "@boardstate/lit/themes/vibrancy.css?url";
import agentHq from "../../../templates/agent-hq.json";
import {
  DEMO_WIDGET_BINDING_ID,
  DEMO_WIDGET_NAME,
  DEMO_WIDGET_TITLE,
  DEMO_WIDGET_VALUE,
} from "./demo-widget-content.js";
// Locale tables ported from the source project (partial — core chrome; unlisted
// keys fall back to English). The demo eagerly imports all of them; a real app
// would import just its own.
import { ar } from "@boardstate/lit/locales/ar";
import { de } from "@boardstate/lit/locales/de";
import { es } from "@boardstate/lit/locales/es";
import { fa } from "@boardstate/lit/locales/fa";
import { fr } from "@boardstate/lit/locales/fr";
import { hi } from "@boardstate/lit/locales/hi";
import { id } from "@boardstate/lit/locales/id";
import { it } from "@boardstate/lit/locales/it";
import { ja_JP } from "@boardstate/lit/locales/ja-JP";
import { ko } from "@boardstate/lit/locales/ko";
import { nl } from "@boardstate/lit/locales/nl";
import { pl } from "@boardstate/lit/locales/pl";
import { pt_BR } from "@boardstate/lit/locales/pt-BR";
import { ru } from "@boardstate/lit/locales/ru";
import { th } from "@boardstate/lit/locales/th";
import { tr } from "@boardstate/lit/locales/tr";
import { uk } from "@boardstate/lit/locales/uk";
import { vi } from "@boardstate/lit/locales/vi";
import { zh_CN } from "@boardstate/lit/locales/zh-CN";
import { zh_TW } from "@boardstate/lit/locales/zh-TW";
import type { BoardstateStrings } from "@boardstate/lit";

const LOCALE_TABLES: Record<string, BoardstateStrings | undefined> = {
  en: undefined, // built-in default
  ar,
  de,
  es,
  fa,
  fr,
  hi,
  id,
  it,
  "ja-JP": ja_JP,
  ko,
  nl,
  pl,
  "pt-BR": pt_BR,
  ru,
  th,
  tr,
  uk,
  vi,
  "zh-CN": zh_CN,
  "zh-TW": zh_TW,
};

const SIM_AGENT = "agent:sales-bot";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// "Graphite" is the shipped default (baked into @boardstate/lit/styles.css), so
// it needs no extra sheet. The alternates layer over the base as drop-in URLs —
// exactly the trick a consumer uses to ship a brand theme.
const THEME_URLS: Record<string, string | null> = {
  graphite: null,
  aurora: auroraThemeUrl,
  vibrancy: vibrancyThemeUrl,
};

/** Swap the active theme stylesheet (Graphite = base default / Aurora / Vibrancy). */
function applyTheme(name: string): void {
  const url = THEME_URLS[name] ?? null;
  let link = document.getElementById("theme-link") as HTMLLinkElement | null;
  if (!url) {
    // Back to the built-in Graphite default: detach any alternate sheet.
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement("link");
    link.id = "theme-link";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  link.href = url;
}

/** Flip the whole page between light and dark (drives the `data-theme` tokens). */
function applyMode(mode: "light" | "dark"): void {
  document.documentElement.dataset.theme = mode;
  const btn = document.getElementById("mode");
  if (btn) btn.textContent = mode === "dark" ? "🌙 Dark" : "☀️ Light";
}

/** The mounted view, so the language control can push `strings` into it. */
let activeView: (HTMLElement & { strings?: BoardstateStrings }) | null = null;

function wireLanguageControl(): void {
  const select = document.getElementById("lang") as HTMLSelectElement | null;
  select?.addEventListener("change", () => {
    if (activeView) activeView.strings = LOCALE_TABLES[select.value];
  });
}

function wireThemeControls(): void {
  const select = document.getElementById("theme") as HTMLSelectElement | null;
  const mode = document.getElementById("mode") as HTMLButtonElement | null;
  applyTheme(select?.value ?? "graphite");
  applyMode("dark");
  select?.addEventListener("change", () => applyTheme(select.value));
  mode?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyMode(next);
  });
}

async function main(): Promise<void> {
  wireThemeControls();
  wireLanguageControl();

  const storage = new MemoryStorageAdapter();
  const store = new DashboardStore({ storage });
  const host = createInProcessHost(store, storage);
  registerBoardstateRpc(host, {
    store,
    // Gallery install, browser edition. The node installer writes bundle files to
    // disk then registers the widget `pending`; here the starter widgets' files
    // are ALREADY hosted statically (public/widgets/<name>/), so installing is
    // purely the document-side registration — same approval gate (pending only),
    // same "widget already exists" rule.
    installWidgetBundle: async (targetStore, bundle, ctx) => {
      const result = await targetStore.mutate(
        (draft) => {
          if (draft.widgetsRegistry[bundle.name]) {
            throw new Error("widget already exists");
          }
          draft.widgetsRegistry[bundle.name] = { status: "pending", createdBy: ctx.actor };
        },
        { actor: ctx.actor },
      );
      return { doc: result.doc };
    },
  });

  // Point the widget gallery at the demo's own registry (public/registry/) so
  // Browse → Install works out of the box. Only seeded when the operator hasn't
  // chosen a registry themselves.
  const galleryUrl = new URL(`${import.meta.env.BASE_URL}registry/index.json`, location.href).href;
  if (!localStorage.getItem("boardstate:gallery-url:v1")) {
    localStorage.setItem("boardstate:gallery-url:v1", galleryUrl);
  }

  // Seed the "Agent HQ" template so the board looks composed on first paint.
  await host.request("dashboard.workspace.replace", {
    doc: agentHq as WorkspaceDoc,
    actor: "user",
  });

  const view = document.createElement("boardstate-view") as HTMLElement & {
    transport?: unknown;
    connected?: boolean;
    basePath?: string;
    strings?: BoardstateStrings;
    storage?: Pick<Storage, "getItem" | "setItem">;
  };
  activeView = view;
  view.transport = host;
  view.connected = true;
  // Persistence seam for view conveniences (remembered gallery URL, etc.).
  view.storage = localStorage;
  // Widget assets resolve under Vite's base ("/" in dev, "/boardstate/" on the
  // hosted demo) — widgetAssetUrl() joins `${basePath}/widgets/<name>/<file>`.
  view.basePath = import.meta.env.BASE_URL.replace(/\/+$/, "");
  document.getElementById("app")!.appendChild(view);

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
      // A real host would write widget.json + index.html to disk here (SPEC §9's
      // scaffold). In this no-backend demo those files already sit in public/
      // widgets/, so "scaffolding" is purely the document-side registration below.
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
