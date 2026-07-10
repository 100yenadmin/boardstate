// Boardstate reference app — "plug in a provider, watch the AI build your dashboard."
// Same fully-in-browser host as examples/standalone (in-process `@boardstate/server`
// over `MemoryStorageAdapter`, rendered by `<boardstate-view>`), but the scripted mock
// agent is swappable for a REAL model loop: `@boardstate/agent`'s `createAgentChatAgent`
// drives whatever provider the user plugs in, browser → provider, no server.
//
// Layout: a board view on the left, and a chat DOCK on the right — a SECOND
// `<boardstate-view>` sharing the same host but pinned (`initialTab`) to a hidden,
// full-bleed "assistant" chat tab, its own tab strip / page header hidden by CSS. Both
// views share the transport, so chatting in the dock edits the board live.

import { DashboardStore, MemoryStorageAdapter, type WorkspaceDoc } from "@boardstate/core";
import {
  createChatSessions,
  createDashboardCoreTools,
  createInProcessHost,
  registerBoardstateRpc,
} from "@boardstate/server";
import type { ChatAgent } from "@boardstate/server";
import { createAgentChatAgent } from "@boardstate/agent";
import { createMockAgent } from "./mock-agent.js";
// The mock data connector + system-prompt addendum are owned by the sibling lane; we
// import them as a stable contract: installMockConnector(host) wires the demo feed,
// MOCK_DATA_PROMPT tells the live agent what data it can bind to.
import { installMockConnector, MOCK_DATA_PROMPT } from "./mock-connector.js";
import { createProviderPicker } from "./provider-picker.js";
import { createCostMeter } from "./cost-meter.js";
import "./app.css";
import "@boardstate/lit";
import "@boardstate/lit/styles.css";
import auroraThemeUrl from "@boardstate/lit/themes/aurora.css?url";
import vibrancyThemeUrl from "@boardstate/lit/themes/vibrancy.css?url";
import agentHq from "../../../templates/agent-hq.json";
import showcase from "../../../templates/showcase.json";
import smallbiz from "../../../templates/smallbiz.json";
import maintainer from "../../../templates/maintainer.json";
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
  en: undefined,
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

const SESSION_KEY = "app";
const ASSISTANT_SLUG = "assistant";

const THEME_URLS: Record<string, string | null> = {
  graphite: null,
  aurora: auroraThemeUrl,
  vibrancy: vibrancyThemeUrl,
};

function applyTheme(name: string): void {
  const url = THEME_URLS[name] ?? null;
  let link = document.getElementById("theme-link") as HTMLLinkElement | null;
  if (!url) {
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

function applyMode(mode: "light" | "dark"): void {
  document.documentElement.dataset.theme = mode;
  const btn = document.getElementById("mode");
  if (btn) btn.textContent = mode === "dark" ? "🌙 Dark" : "☀️ Light";
}

/** Both mounted views, so the language control can push `strings` into each. */
const activeViews: Array<HTMLElement & { strings?: BoardstateStrings }> = [];

const BOARDS: Record<string, unknown> = {
  "agent-hq": agentHq,
  showcase,
  smallbiz,
  maintainer,
};

/**
 * Return a clone of `doc` guaranteed to carry a HIDDEN, full-bleed "assistant" tab
 * with a single chat widget — the dock's second view pins to it via `initialTab`,
 * while the board view keeps it out of its visible strip. Every board the picker
 * loads passes through here, so the dock always has its chat surface.
 */
function withAssistantTab(doc: unknown): WorkspaceDoc {
  const clone = structuredClone(doc) as WorkspaceDoc;
  clone.tabs = clone.tabs.filter((tab) => tab.slug !== ASSISTANT_SLUG);
  clone.tabs.push({
    slug: ASSISTANT_SLUG,
    title: "Assistant",
    hidden: true,
    layout: "full",
    createdBy: "system",
    widgets: [
      {
        id: "assistant-chat",
        kind: "builtin:chat",
        title: "Assistant",
        grid: { x: 0, y: 0, w: 12, h: 20 },
        collapsed: false,
        hidden: false,
        props: {
          placeholder: "Ask the agent to build you a view — try “build me a SaaS metrics board”",
        },
      },
    ],
  } as WorkspaceDoc["tabs"][number]);
  // Keep tabOrder (if present) referencing only tabs that still exist.
  if (clone.prefs?.tabOrder) {
    const slugs = new Set(clone.tabs.map((tab) => tab.slug));
    clone.prefs.tabOrder = clone.prefs.tabOrder.filter((slug) => slugs.has(slug));
  }
  return clone;
}

function wireBoardPicker(host: ReturnType<typeof createInProcessHost>): void {
  const select = document.getElementById("board") as HTMLSelectElement | null;
  select?.addEventListener("change", async () => {
    const doc = BOARDS[select.value];
    if (!doc) return;
    await host.request("dashboard.workspace.replace", {
      doc: withAssistantTab(doc),
      actor: "user",
    });
  });
}

function wireLanguageControl(): void {
  const select = document.getElementById("lang") as HTMLSelectElement | null;
  select?.addEventListener("change", () => {
    for (const view of activeViews) view.strings = LOCALE_TABLES[select.value];
    document.documentElement.dir = ["ar", "fa"].includes(select.value) ? "rtl" : "ltr";
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

/** A draggable divider that resizes the chat dock (clamped 320–560px). */
function wireDockDivider(): void {
  const shell = document.getElementById("app-shell")!;
  const divider = document.getElementById("dock-divider")!;
  let dragging = false;
  const onMove = (event: PointerEvent): void => {
    if (!dragging) return;
    const width = Math.min(560, Math.max(320, window.innerWidth - event.clientX));
    shell.style.setProperty("--dock-width", `${width}px`);
  };
  divider.addEventListener("pointerdown", (event) => {
    dragging = true;
    divider.dataset.dragging = "true";
    divider.setPointerCapture(event.pointerId);
  });
  divider.addEventListener("pointermove", onMove);
  divider.addEventListener("pointerup", (event) => {
    dragging = false;
    delete divider.dataset.dragging;
    divider.releasePointerCapture(event.pointerId);
  });
}

/**
 * The 3 suggested prompt chips: on empty transcript, seed + send a starter prompt into
 * the dock's chat widget (find its textarea, submit through the real send button). The
 * strip hides once the transcript is no longer empty.
 */
function wirePromptChips(dock: HTMLElement): void {
  const container = document.getElementById("prompt-chips")!;
  const prompts = [
    "Build me a SaaS metrics board",
    "Make an incident dashboard for on-call",
    "Add a live ticker tab bound to the demo feed",
  ];
  for (const prompt of prompts) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "prompt-chip";
    chip.textContent = prompt;
    chip.addEventListener("click", () => {
      const textarea = dock.querySelector<HTMLTextAreaElement>(".dashboard-chat__textarea");
      const send = dock.querySelector<HTMLButtonElement>("[data-test-id='dashboard-chat-send']");
      if (!textarea || !send) return;
      textarea.value = prompt;
      send.click();
    });
    container.appendChild(chip);
  }
  // Show chips only while the transcript is empty (the widget renders the empty state).
  const sync = (): void => {
    const empty = dock.querySelector("[data-test-id='dashboard-chat-empty']") !== null;
    const mounted = dock.querySelector(".dashboard-chat") !== null;
    container.hidden = mounted && !empty;
  };
  new MutationObserver(sync).observe(dock, { childList: true, subtree: true });
  sync();
}

/**
 * The self-building loop's visible handle (SPEC §15): a persistent button that asks
 * the agent to review its own board — the real agent calls the readOnly
 * `dashboard_design_review` tool and fixes what it agrees with; the mock agent runs
 * the same lint via a scripted flow. Same send mechanics as the prompt chips.
 */
function wireReviewButton(dock: HTMLElement): void {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "review-btn";
  button.dataset.testId = "review-improve";
  button.textContent = "✨ Review & improve";
  button.title = "Ask the agent to critique this board and fix what it agrees with";
  button.addEventListener("click", () => {
    const textarea = dock.querySelector<HTMLTextAreaElement>(".dashboard-chat__textarea");
    const send = dock.querySelector<HTMLButtonElement>("[data-test-id='dashboard-chat-send']");
    if (!textarea || !send) return;
    textarea.value = "Review this board: point out design issues and fix the ones you agree with.";
    send.click();
  });
  document.getElementById("chat-dock-chrome")!.appendChild(button);
}

async function main(): Promise<void> {
  wireThemeControls();
  wireLanguageControl();
  wireDockDivider();

  const storage = new MemoryStorageAdapter();
  const store = new DashboardStore({ storage });
  const host = createInProcessHost(store, storage);
  // The demo data connector (sibling lane) — bindable feeds the agent can wire up.
  installMockConnector(host);

  const chat = createChatSessions({ broadcast: host.broadcast });

  // The chat agent is swapped live: mock until a provider is plugged in, then the real
  // provider loop. A stable delegating agent lets us register RPC once.
  let activeAgent: ChatAgent = createMockAgent(host);
  const delegatingAgent: ChatAgent = (args, ctx) => activeAgent(args, ctx);

  registerBoardstateRpc(host, {
    store,
    chat,
    chatAgent: delegatingAgent,
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

  // Point the widget gallery at the demo registry (copied into public/) so Browse →
  // Install works out of the box, only when the operator hasn't chosen one.
  const galleryUrl = new URL(`${import.meta.env.BASE_URL}registry/index.json`, location.href).href;
  if (!localStorage.getItem("boardstate:gallery-url:v1")) {
    localStorage.setItem("boardstate:gallery-url:v1", galleryUrl);
  }

  // Seed the Agent HQ board (with the hidden assistant tab) for first paint.
  await host.request("dashboard.workspace.replace", {
    doc: withAssistantTab(agentHq),
    actor: "user",
  });

  const basePath = import.meta.env.BASE_URL.replace(/\/+$/, "");

  // The board view (left).
  const boardView = document.createElement("boardstate-view") as HTMLElement & {
    transport?: unknown;
    connected?: boolean;
    basePath?: string;
    sessionKey?: string;
    storage?: Pick<Storage, "getItem" | "setItem">;
    strings?: BoardstateStrings;
    operator?: boolean;
  };
  boardView.transport = host;
  boardView.connected = true;
  boardView.storage = localStorage;
  boardView.basePath = basePath;
  boardView.sessionKey = SESSION_KEY;
  // This reference app drives an in-process host — it IS the local operator, so it may
  // offer inline confirm/deny for a parked action (SPEC §18). A networked embedder omits
  // this; the confirm affordance then renders disabled-with-reason.
  boardView.operator = true;
  activeViews.push(boardView);
  document.getElementById("board-area")!.appendChild(boardView);

  // The chat dock (right) — a second view pinned to the hidden assistant tab.
  const dockView = document.createElement("boardstate-view") as HTMLElement & {
    transport?: unknown;
    connected?: boolean;
    basePath?: string;
    initialTab?: string;
    sessionKey?: string;
    storage?: Pick<Storage, "getItem" | "setItem">;
    strings?: BoardstateStrings;
  };
  dockView.transport = host;
  dockView.connected = true;
  dockView.storage = localStorage;
  dockView.basePath = basePath;
  dockView.initialTab = ASSISTANT_SLUG;
  dockView.sessionKey = SESSION_KEY;
  activeViews.push(dockView);
  document.getElementById("chat-dock")!.appendChild(dockView);

  wireBoardPicker(host);
  wirePromptChips(document.getElementById("chat-dock")!);
  wireReviewButton(document.getElementById("chat-dock")!);

  const costMeter = createCostMeter(host, document.getElementById("cost-meter")!, SESSION_KEY);

  createProviderPicker({
    host,
    mount: document.body,
    statusPill: document.getElementById("provider-pill")!,
    gearButton: document.getElementById("provider-gear")!,
    corsCard: document.getElementById("cors-card")!,
    onConnect: (adapter, _def, model) => {
      activeAgent = createAgentChatAgent({
        host,
        provider: adapter,
        // The browser-safe dashboard_* tool set — without this the real model can
        // chat but never touch the board (host.tools() is empty in a browser host;
        // scaffold/file-read stay node-only behind @boardstate/server/node).
        tools: createDashboardCoreTools({
          store,
          context: { agentId: "assistant" },
          broadcast: host.broadcast,
        }),
        systemExtras: MOCK_DATA_PROMPT,
        // M4a: after any board-mutating turn, one bounded self-review pass — the
        // model critiques its own board via dashboard_design_review and fixes what
        // it agrees with, still inside the same chat turn.
        selfReview: "once",
      });
      costMeter.setModel(model);
    },
    onMock: () => {
      activeAgent = createMockAgent(host);
      costMeter.setModel(null);
    },
  });
}

void main();
