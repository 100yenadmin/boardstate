// The provider registry the picker offers. Each entry is enough to build a
// `@boardstate/agent` adapter (`anthropicAdapter` / `openAICompatAdapter`) from a
// user-supplied key + model — the app never bakes in a provider, it plugs one in.
//
// `corsMode` is an HONEST heads-up about calling the provider DIRECTLY from a browser
// (no server here): some providers set permissive CORS, some hard-block it. It only
// tunes the picker's copy — the request still goes browser → provider, and a blocked
// call surfaces as the in-dock CORS card, not a silent failure.

export type ProviderKind = "anthropic" | "openai";

/** How a direct browser → provider call is expected to fare (copy-only hint). */
export type CorsMode =
  | "header" // needs a special browser-access header (Anthropic) — see note
  | "blocked-likely" // provider historically blocks browser origins
  | "local" // localhost daemon, typically CORS-open
  | "unknown"; // untested from the browser

export interface ProviderDef {
  id: string;
  label: string;
  /** Which adapter shape to build: Anthropic Messages, or OpenAI /chat/completions. */
  kind: ProviderKind;
  /** Prefilled, editable API root. Empty ⇒ the adapter default (Anthropic only). */
  baseUrl: string;
  /** A second base worth mentioning (e.g. GLM's OpenAI-compat root). */
  altBaseUrl?: string;
  /** Suggested models; the picker's combo lets the user type any other id. */
  models: string[];
  corsMode: CorsMode;
  /** Placeholder / label for the key field. */
  keyHint: string;
  /** A key isn't required (e.g. a local Ollama daemon). */
  keyOptional?: boolean;
  /** Prefilled key value (e.g. Ollama's ignored "ollama" token). */
  defaultKey?: string;
  /** The base URL is user-entered from scratch (no useful default). */
  customBaseUrl?: boolean;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: "glm",
    label: "GLM (z.ai)",
    kind: "anthropic",
    baseUrl: "https://api.z.ai/api/anthropic",
    altBaseUrl: "https://api.z.ai/api/paas/v4",
    models: ["glm-4.7", "glm-4.6"],
    corsMode: "unknown",
    keyHint: "Z.ai API key",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    kind: "anthropic",
    // Empty ⇒ the adapter's default (https://api.anthropic.com).
    baseUrl: "",
    models: ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5"],
    // NOTE: a direct browser call needs `anthropic-dangerous-direct-browser-access:
    // true`, which the shipped adapter does NOT send — so api.anthropic.com blocks the
    // request from a page. Run this provider locally (self-host recipe in the README).
    corsMode: "header",
    keyHint: "Anthropic API key",
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-5.5", "gpt-5.4"],
    corsMode: "blocked-likely",
    keyHint: "OpenAI API key",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    kind: "openai",
    baseUrl: "http://localhost:11434/v1",
    models: ["llama3.3", "qwen3"],
    corsMode: "local",
    keyHint: "not required",
    keyOptional: true,
    defaultKey: "ollama",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    kind: "openai",
    baseUrl: "",
    models: [],
    corsMode: "unknown",
    keyHint: "API key (if required)",
    keyOptional: true,
    customBaseUrl: true,
  },
];

export function findProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}
