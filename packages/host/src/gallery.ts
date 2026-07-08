// Widget-gallery network half (CLIENT-side fetch + install). The OPERATOR'S
// BROWSER fetches a remote registry index / bundle — the host gateway NEVER
// fetches (that would be an SSRF surface); it only receives the already-fetched,
// size-capped bytes via `dashboard.widget.install`, which writes them as a
// `pending` widget behind the approval gate + sandbox. Installing therefore never
// approves and never bypasses the sandbox. Parsing/validation is pure and lives in
// `@boardstate/core`.

import {
  GALLERY_BUNDLE_MAX_BYTES,
  GALLERY_INDEX_MAX_BYTES,
  galleryByteLength,
  parseGalleryIndex,
  parseWidgetBundle,
  type GalleryBundle,
  type GalleryEntry,
  type Transport,
} from "@boardstate/core";

export { GALLERY_BUNDLE_MAX_BYTES, GALLERY_INDEX_MAX_BYTES };
export type { GalleryBundle, GalleryEntry };

async function fetchTextCapped(url: string, maxBytes: number, label: string): Promise<string> {
  if (typeof fetch !== "function") {
    throw new Error("This browser cannot fetch the widget gallery.");
  }
  // credentials:"omit" — the registry is a third-party origin; never attach the
  // operator's gateway cookies to it.
  const res = await fetch(url, {
    method: "GET",
    credentials: "omit",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`${label} request failed (${res.status}).`);
  }
  const text = await res.text();
  if (galleryByteLength(text) > maxBytes) {
    throw new Error(`${label} is too large (max ${Math.floor(maxBytes / 1024)} KB).`);
  }
  return text;
}

/**
 * Fetch and parse a registry `index.json` (CLIENT fetch). Relative `manifestUrl`s
 * resolve against the index URL; malformed entries are dropped rather than throwing.
 */
export async function fetchGalleryIndex(indexUrl: string): Promise<GalleryEntry[]> {
  const text = await fetchTextCapped(indexUrl, GALLERY_INDEX_MAX_BYTES, "The gallery index");
  return parseGalleryIndex(text, indexUrl);
}

/**
 * Fetch a widget bundle (CLIENT fetch) and shape-check it. Enforces the 512 KB cap
 * before parsing. Authoritative manifest validation happens server-side on install.
 */
export async function fetchWidgetBundle(bundleUrl: string): Promise<GalleryBundle> {
  const text = await fetchTextCapped(bundleUrl, GALLERY_BUNDLE_MAX_BYTES, "The widget bundle");
  return parseWidgetBundle(text);
}

/**
 * Install a fetched bundle via the transport. Writes a `pending` registry entry
 * (never approved); the operator still approves through the approval gate before
 * the widget mounts in its sandbox. Passes only the already-fetched bytes — no URL.
 */
export async function installGalleryWidget(
  transport: Transport | null,
  bundle: GalleryBundle,
): Promise<void> {
  if (!transport) {
    throw new Error("Not connected.");
  }
  await transport.request("dashboard.widget.install", {
    name: bundle.name,
    manifest: bundle.manifest,
    files: bundle.files,
  });
}
