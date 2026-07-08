// builtin:iframe-embed — URL policy for an embedded frame. `props.url` supplies
// the src; external http(s) URLs are blocked unless the host policy allows them,
// and any non-http(s) scheme is rejected outright. Sandboxing + rendering is a
// host presentation concern; this is the pure classification the renderer gates on.

export type EmbedUrlDecision =
  | { status: "missing" }
  | { status: "blocked"; reason: "external" | "scheme"; url: string }
  | { status: "ok"; url: string; external: boolean };

/**
 * Resolve `rawUrl` against the embed policy. Relative URLs and same-origin
 * absolute URLs are internal and always allowed. Absolute http(s) URLs to a
 * different origin are external and require `allowExternalEmbedUrls`. Any other
 * scheme (javascript:, data:, file:, …) is rejected outright.
 */
export function evaluateEmbedUrl(
  rawUrl: unknown,
  policy: { allowExternalEmbedUrls: boolean },
  origin?: string,
): EmbedUrlDecision {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return { status: "missing" };
  }
  const url = rawUrl.trim();
  // DOM-free origin fallback: read a document origin when one exists (browser
  // host) via globalThis, without referencing a browser-only `window` global.
  const ambientOrigin = (globalThis as { location?: { origin?: string } }).location?.origin;
  const base = origin ?? ambientOrigin;
  let parsed: URL;
  try {
    // A relative URL resolves against the current origin; an absolute URL keeps
    // its own. Without a base, relative URLs cannot be classified — treat as
    // internal (they cannot escape the current document).
    parsed = base ? new URL(url, base) : new URL(url);
  } catch {
    // Relative URL with no base to resolve against: internal by construction.
    return { status: "ok", url, external: false };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { status: "blocked", reason: "scheme", url };
  }
  const external = base ? parsed.origin !== new URL(base).origin : true;
  if (external && !policy.allowExternalEmbedUrls) {
    return { status: "blocked", reason: "external", url };
  }
  return { status: "ok", url, external };
}
