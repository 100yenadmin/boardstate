// The first-run "plug in your AI" hero + the connection lifecycle. It builds a
// `@boardstate/agent` provider adapter from a user-supplied key/model (all in the
// browser — the key never leaves the page) and hands it up via `onConnect`; the
// "Try without a key" path hands back to the scripted mock via `onMock`.
//
// It also owns the two connection-status surfaces: the header status pill and the
// in-dock CORS card, which lights up when a direct browser → provider call is
// blocked (the honest failure mode of a no-server app).

import { anthropicAdapter, openAICompatAdapter, type ProviderAdapter } from "@boardstate/agent";
import { CHAT_EVENT, type AgentStreamEvent } from "@boardstate/schema";
import { PROVIDERS, findProvider, type ProviderDef } from "./providers.js";

const STORAGE_KEY = "bsapp:provider:v1";

interface EventSource {
  addEventListener(event: string, fn: (payload: unknown) => void): () => void;
}

export interface ProviderPickerOptions {
  /** Broadcast bus, watched for CORS-shaped error events. */
  host: EventSource;
  /** Where the dimming overlay + hero card mounts. */
  mount: HTMLElement;
  /** Header pill reflecting connection status. */
  statusPill: HTMLElement;
  /** Header gear button that reopens the picker. */
  gearButton: HTMLElement;
  /** Dock element the CORS card renders into. */
  corsCard: HTMLElement;
  /** A real provider was connected — swap in the live agent. */
  onConnect: (adapter: ProviderAdapter, def: ProviderDef, model: string) => void;
  /** Mock mode chosen — swap in the scripted agent. */
  onMock: () => void;
}

interface Remembered {
  id: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

function loadRemembered(): Remembered | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Remembered) : null;
  } catch {
    return null;
  }
}

function buildAdapter(
  def: ProviderDef,
  baseUrl: string,
  apiKey: string,
  model: string,
): ProviderAdapter {
  if (def.kind === "anthropic") {
    return anthropicAdapter({ apiKey, model, ...(baseUrl ? { baseUrl } : {}) });
  }
  return openAICompatAdapter({ baseUrl, apiKey, model });
}

/** True for an error event that reads like a blocked browser fetch (CORS / network). */
function looksLikeCors(event: AgentStreamEvent): boolean {
  if (event.type !== "error") return false;
  return (
    event.code === "TypeError" ||
    event.code === "network_error" ||
    /cors|failed to fetch|networkerror|load failed|fetch failed|network/i.test(event.message)
  );
}

export interface ProviderPickerHandle {
  open(): void;
}

export function createProviderPicker(options: ProviderPickerOptions): ProviderPickerHandle {
  const { host, mount, statusPill, gearButton, corsCard } = options;
  let currentLabel: string | null = null; // null ⇒ mock mode

  // --- header status pill -------------------------------------------------
  function setMock(): void {
    currentLabel = null;
    statusPill.dataset.state = "mock";
    statusPill.innerHTML = `<span class="pill-dot" aria-hidden="true">○</span><span>mock</span>`;
    statusPill.title = "No provider connected — the scripted demo agent is driving.";
  }
  function setConnected(def: ProviderDef, model: string): void {
    currentLabel = def.label;
    statusPill.dataset.state = "live";
    statusPill.innerHTML =
      `<span class="pill-dot" aria-hidden="true">●</span>` + `<span>${def.id} · ${model}</span>`;
    statusPill.title = `Connected to ${def.label} (${model}) — requests go straight from this browser.`;
    corsCard.hidden = true;
  }

  // --- CORS card ----------------------------------------------------------
  host.addEventListener(CHAT_EVENT, (payload) => {
    const event = payload as AgentStreamEvent;
    if (currentLabel === null) return; // mock agent never makes network calls
    if (!looksLikeCors(event)) return;
    corsCard.innerHTML =
      `<div class="cors-card__title">「${currentLabel}」 blocked the browser call (CORS).</div>` +
      `<div class="cors-card__body">Run it locally instead — the self-host recipe is in the ` +
      `<a href="https://github.com/100yenadmin/boardstate#readme" target="_blank" rel="noopener">README</a>.</div>`;
    corsCard.hidden = false;
  });

  // --- hero overlay -------------------------------------------------------
  const overlay = document.createElement("div");
  overlay.className = "picker-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <form class="picker-card" data-test-id="provider-picker">
      <h2 class="picker-card__title">Plug in your AI</h2>
      <p class="picker-card__sub">Pick a provider and watch it build your dashboard live.</p>

      <label class="picker-field">
        <span>Provider</span>
        <select name="provider" data-test-id="picker-provider">
          ${PROVIDERS.map((provider) => `<option value="${provider.id}">${provider.label}</option>`).join("")}
        </select>
      </label>

      <label class="picker-field">
        <span>Base URL</span>
        <input name="baseUrl" type="text" spellcheck="false" autocomplete="off" placeholder="https://…" />
      </label>

      <label class="picker-field">
        <span>API key</span>
        <input name="apiKey" type="password" autocomplete="off" spellcheck="false" />
        <small class="picker-note">Your key stays in this browser (memory; localStorage only if you tick remember). Requests go directly from your browser to the provider — there is no server here.</small>
      </label>

      <label class="picker-check">
        <input name="remember" type="checkbox" />
        <span>Remember key on this device</span>
      </label>

      <label class="picker-field">
        <span>Model</span>
        <input name="model" type="text" list="picker-models" spellcheck="false" autocomplete="off" placeholder="model id" />
        <datalist id="picker-models"></datalist>
      </label>

      <div class="picker-cors-hint" data-test-id="picker-cors-hint"></div>

      <div class="picker-actions">
        <button type="submit" class="picker-btn picker-btn--primary" data-test-id="picker-connect">Connect</button>
        <button type="button" class="picker-btn picker-btn--ghost" data-test-id="picker-mock">Try without a key →</button>
      </div>
    </form>
  `;
  mount.appendChild(overlay);

  const form = overlay.querySelector<HTMLFormElement>(".picker-card")!;
  const providerSelect = form.querySelector<HTMLSelectElement>("select[name='provider']")!;
  const baseUrlInput = form.querySelector<HTMLInputElement>("input[name='baseUrl']")!;
  const keyInput = form.querySelector<HTMLInputElement>("input[name='apiKey']")!;
  const rememberInput = form.querySelector<HTMLInputElement>("input[name='remember']")!;
  const modelInput = form.querySelector<HTMLInputElement>("input[name='model']")!;
  const modelList = form.querySelector<HTMLDataListElement>("#picker-models")!;
  const keyField = keyInput.closest(".picker-field") as HTMLElement;
  const corsHint = form.querySelector<HTMLElement>(".picker-cors-hint")!;

  const CORS_COPY: Record<string, string> = {
    header:
      "Heads-up: a direct browser call to Anthropic is blocked (the adapter can't send the browser-access header). Use this via a local self-host — see the README.",
    "blocked-likely":
      "Heads-up: this provider usually blocks direct browser calls. If it fails, self-host (README).",
    local:
      "Local daemon — make sure it's running and allows browser origins (e.g. OLLAMA_ORIGINS).",
    unknown: "",
  };

  /** Repaint the adaptive fields for the selected provider. */
  function syncFields(def: ProviderDef, prefill?: Remembered): void {
    baseUrlInput.value = prefill?.baseUrl ?? def.baseUrl;
    baseUrlInput.placeholder = def.customBaseUrl
      ? "https://your-endpoint/v1"
      : def.baseUrl || "provider default";
    baseUrlInput.required = def.kind === "openai";
    keyInput.value = prefill?.apiKey ?? def.defaultKey ?? "";
    keyInput.placeholder = def.keyHint;
    keyInput.required = !def.keyOptional;
    keyField.dataset.optional = def.keyOptional ? "true" : "false";
    modelInput.value = prefill?.model ?? def.models[0] ?? "";
    modelList.innerHTML = def.models.map((model) => `<option value="${model}"></option>`).join("");
    corsHint.textContent = CORS_COPY[def.corsMode] ?? "";
    corsHint.hidden = !corsHint.textContent;
  }

  const remembered = loadRemembered();
  const initialDef = (remembered && findProvider(remembered.id)) || PROVIDERS[0]!;
  providerSelect.value = initialDef.id;
  rememberInput.checked = Boolean(remembered?.apiKey);
  syncFields(initialDef, remembered ?? undefined);

  providerSelect.addEventListener("change", () => {
    const def = findProvider(providerSelect.value);
    if (def) syncFields(def);
  });

  function close(): void {
    overlay.hidden = true;
  }
  function open(): void {
    overlay.hidden = false;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const def = findProvider(providerSelect.value);
    if (!def) return;
    const baseUrl = baseUrlInput.value.trim();
    const apiKey = keyInput.value.trim();
    const model = modelInput.value.trim();
    if (!model) {
      modelInput.focus();
      return;
    }
    if (def.kind === "openai" && !baseUrl) {
      baseUrlInput.focus();
      return;
    }
    if (!def.keyOptional && !apiKey) {
      keyInput.focus();
      return;
    }

    if (rememberInput.checked) {
      const record: Remembered = { id: def.id, baseUrl, model, apiKey };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
      } catch {
        // Storage full / blocked — the connection still works in memory.
      }
    } else {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }

    corsCard.hidden = true;
    setConnected(def, model);
    options.onConnect(buildAdapter(def, baseUrl, apiKey, model), def, model);
    close();
  });

  form
    .querySelector<HTMLButtonElement>("[data-test-id='picker-mock']")!
    .addEventListener("click", () => {
      setMock();
      corsCard.hidden = true;
      options.onMock();
      close();
    });

  gearButton.addEventListener("click", open);

  // First paint: mock mode, hero open.
  setMock();
  open();

  return { open };
}
