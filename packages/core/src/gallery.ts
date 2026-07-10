// Widget-gallery parsing/validation (pure). The network half — the OPERATOR'S
// BROWSER fetching a remote registry index or bundle, and the size-capped install
// RPC — lives in the host package (`@boardstate/host`), preserving the no-SSRF
// model: the gateway NEVER fetches, it only receives already-fetched bytes. This
// module only parses + shape-checks the fetched text.

import { validateRecipe, type RecipeIndexEntry, type TemplateRecipe } from "@boardstate/schema";
import type { DashboardWidgetCapability } from "./types.js";

export type { RecipeIndexEntry, TemplateRecipe };

/** Hard client-side cap on a fetched bundle; the host re-checks server-side. */
export const GALLERY_BUNDLE_MAX_BYTES = 512 * 1024;
/** Hard client-side cap on a fetched recipe bundle (a doc can be large but bounded). */
export const GALLERY_RECIPE_MAX_BYTES = 512 * 1024;
/** Hard client-side cap on a fetched registry index. */
export const GALLERY_INDEX_MAX_BYTES = 256 * 1024;

const CUSTOM_WIDGET_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** One entry in a registry `index.json`. */
export type GalleryEntry = {
  name: string;
  description: string;
  /** Absolute URL of the widget bundle JSON (resolved against the index URL). */
  manifestUrl: string;
};

/** A fetched, shape-checked widget bundle ready to hand to the install RPC. */
export type GalleryBundle = {
  name: string;
  title: string;
  /** Capabilities the widget requests — surfaced BEFORE the operator installs/approves. */
  capabilities: DashboardWidgetCapability[];
  bindingIds: string[];
  /** The raw `widget.json` object (validated authoritatively server-side on install). */
  manifest: Record<string, unknown>;
  /** Logical file path → text content. */
  files: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** UTF-8 byte length of a string (the cap unit; enforced by the host fetch layer). */
export function galleryByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Parse a registry `index.json` text (CLIENT-fetched). Accepts either a bare array
 * of entries or `{ widgets: [...] }`. Relative `manifestUrl`s resolve against
 * `indexUrl`. Malformed entries are dropped rather than throwing.
 */
export function parseGalleryIndex(text: string, indexUrl: string): GalleryEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The gallery index is not valid JSON.");
  }
  const rawList = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.widgets)
      ? parsed.widgets
      : null;
  if (!rawList) {
    throw new Error("The gallery index must be a list of widgets.");
  }
  const entries: GalleryEntry[] = [];
  for (const raw of rawList) {
    if (!isRecord(raw)) {
      continue;
    }
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const manifestUrlRaw = typeof raw.manifestUrl === "string" ? raw.manifestUrl.trim() : "";
    if (!CUSTOM_WIDGET_NAME_PATTERN.test(name) || !manifestUrlRaw) {
      continue;
    }
    let manifestUrl: string;
    try {
      manifestUrl = new URL(manifestUrlRaw, indexUrl).toString();
    } catch {
      continue;
    }
    entries.push({
      name,
      description: typeof raw.description === "string" ? raw.description : "",
      manifestUrl,
    });
  }
  return entries;
}

function readCapabilities(value: unknown): DashboardWidgetCapability[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (cap): cap is DashboardWidgetCapability => cap === "data:read" || cap === "prompt:send",
  );
}

function readBindingIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((binding) => (isRecord(binding) && typeof binding.id === "string" ? binding.id : null))
    .filter((id): id is string => id !== null);
}

/**
 * Parse a widget-bundle text (CLIENT-fetched) and shape-check it enough to preview
 * and hand to the install RPC. The bundle is `{ manifest, files }`; the manifest is
 * the widget's `widget.json` object. Authoritative manifest validation happens
 * server-side on install.
 */
export function parseWidgetBundle(text: string): GalleryBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The widget bundle is not valid JSON.");
  }
  if (!isRecord(parsed) || !isRecord(parsed.manifest) || !isRecord(parsed.files)) {
    throw new Error("The widget bundle must be an object with `manifest` and `files`.");
  }
  const manifest = parsed.manifest;
  const name = typeof manifest.name === "string" ? manifest.name.trim() : "";
  if (!CUSTOM_WIDGET_NAME_PATTERN.test(name)) {
    throw new Error("The widget bundle manifest has an invalid name.");
  }
  const files: Record<string, string> = {};
  for (const [key, content] of Object.entries(parsed.files)) {
    if (typeof content !== "string") {
      throw new Error("Every widget bundle file must be text.");
    }
    files[key] = content;
  }
  return {
    name,
    title: typeof manifest.title === "string" ? manifest.title : name,
    capabilities: readCapabilities(manifest.capabilities),
    bindingIds: readBindingIds(manifest.bindings),
    manifest,
    files,
  };
}

const RECIPE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Parse a registry `index.json` text's `recipes` array (CLIENT-fetched), sibling of the
 * widget entries. Relative `manifestUrl`s resolve against `indexUrl`; malformed entries
 * are dropped rather than throwing. An index with no `recipes` key yields `[]`.
 */
export function parseRecipeIndex(text: string, indexUrl: string): RecipeIndexEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The gallery index is not valid JSON.");
  }
  const rawList = isRecord(parsed) && Array.isArray(parsed.recipes) ? parsed.recipes : null;
  if (!rawList) {
    return [];
  }
  const entries: RecipeIndexEntry[] = [];
  for (const raw of rawList) {
    if (!isRecord(raw)) {
      continue;
    }
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const manifestUrlRaw = typeof raw.manifestUrl === "string" ? raw.manifestUrl.trim() : "";
    if (!RECIPE_NAME_PATTERN.test(name) || !manifestUrlRaw) {
      continue;
    }
    let manifestUrl: string;
    try {
      manifestUrl = new URL(manifestUrlRaw, indexUrl).toString();
    } catch {
      continue;
    }
    const connectors = Array.isArray(raw.connectors)
      ? raw.connectors.filter((c): c is string => typeof c === "string")
      : [];
    entries.push({
      name,
      title: typeof raw.title === "string" && raw.title ? raw.title : name,
      description: typeof raw.description === "string" ? raw.description : "",
      manifestUrl,
      connectors,
    });
  }
  return entries;
}

/**
 * Parse + fully validate a recipe bundle text (CLIENT-fetched). Unlike a widget bundle
 * (whose manifest is authoritatively validated server-side on install), a recipe is pure
 * data applied through `dashboard.workspace.replace`, so it is validated in full HERE with
 * the shared `validateRecipe` — the same guard the honesty gate runs over every shipped
 * recipe. Throws a friendly error on malformed input.
 */
export function parseRecipeBundle(text: string): TemplateRecipe {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The recipe bundle is not valid JSON.");
  }
  try {
    return validateRecipe(parsed);
  } catch (err) {
    throw new Error(
      `The recipe bundle is invalid: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
