// Smoke coverage for the browser-standalone entry (`@boardstate/lit/browser`):
//   (1) importing it in a DOM env registers the custom elements (the runtime contract
//       a plain-browser consumer relies on);
//   (2) the BUILT bundle (`dist/browser.js`) is self-contained — no bare `@boardstate/*`
//       or `lit` specifiers, no `node:*` imports — so it genuinely loads with no
//       bundler / import map (the whole reason the entry exists).
// (2) reads the build output, so it runs under the repo gate (`pnpm build && pnpm test`).

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Locate the built bundle regardless of vitest's cwd (repo root or package root). */
function bundlePath(): string {
  const candidates = [
    resolve(process.cwd(), "dist/browser.js"),
    resolve(process.cwd(), "packages/lit/dist/browser.js"),
  ];
  return candidates.find(existsSync) ?? candidates[0]!;
}

describe("@boardstate/lit/browser", () => {
  it("registers the custom elements when imported in a DOM env", async () => {
    await import("./browser.js");
    expect(customElements.get("boardstate-view")).toBeDefined();
    expect(customElements.get("boardstate-header")).toBeDefined();
  });

  it("builds a self-contained bundle with no bare or node: imports", () => {
    const path = bundlePath();
    expect(
      existsSync(path),
      "dist/browser.js is missing — run `pnpm --filter @boardstate/lit build` first",
    ).toBe(true);
    const source = readFileSync(path, "utf8");

    // No unresolved bare specifiers survived the bundle (lit + @boardstate/* inlined).
    expect(source).not.toMatch(/from\s*["'](@boardstate\/|lit["']|lit\/|@lit\/)/);
    // No Node builtins leaked into the browser chain.
    expect(source).not.toMatch(/["']node:/);
    // The element definitions actually ship in the bundle.
    expect(source).toContain("boardstate-view");
  });
});
