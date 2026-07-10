// The browser-standalone entry: `import "@boardstate/lit/browser"` in a plain browser
// (a `<script type="module">`, no bundler, no import map) defines `<boardstate-view>`
// and `<boardstate-header>` and every builtin widget renderer.
//
// WHY A SEPARATE ENTRY. The default `.` entry (`dist/index.js`) is unbundled ESM: it
// ships bare specifiers (`lit`, `@boardstate/core`, `@boardstate/host`,
// `@boardstate/schema`) that a bundler or import map must resolve — which is why it
// "cannot load in a plain browser" (the serve-host note). It is NOT a Node-builtins
// problem: the whole browser dependency chain imports zero `node:*` (the fs-backed
// pieces live in each package's `/node` entry). This entry is therefore built as a
// SELF-CONTAINED bundle (tsdown `platform: "browser"`, `noExternal` inlining lit +
// the `@boardstate/*` deps) so a single file defines the elements with no resolution
// step. It re-exports the public surface too, so `import { BoardstateViewElement }
// from "@boardstate/lit/browser"` works for a browser-only consumer.
//
// Styling is still a separate concern: load `@boardstate/lit/styles.css` (the view
// renders to light DOM). The custom-element definitions are all this entry ships.

export * from "./index.js";
