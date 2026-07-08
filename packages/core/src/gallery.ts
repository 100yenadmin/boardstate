// Widget-gallery parsing/validation (pure). The network half — the OPERATOR'S
// BROWSER fetching a remote registry index or bundle, and the size-capped install
// RPC — lives in the host package (`@boardstate/host`), preserving the no-SSRF
// model: the gateway NEVER fetches, it only receives already-fetched bytes. This
// module only parses + shape-checks the fetched text.

import type { DashboardWidgetCapability } from "./types.js";

/** Hard client-side cap on a fetched bundle; the host re-checks server-side. */
export const GALLERY_BUNDLE_MAX_BYTES = 512 * 1024;
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
