# calculator

A pure, fully self-contained widget: no bindings, no capabilities, no data
requests. Everything happens client-side with plain event listeners.

Useful as the minimal-footprint starting point for a widget that doesn't
need any dashboard data at all — a small tool, converter, or reference view.
It still sends `dashboard:ready` on load for protocol consistency, but that
is the only message it sends; the parent has no obligation to reply to
anything since no `getData`/`getTheme`/`sendPrompt` request is ever made.

See `docs/authoring.md` for the full protocol this template intentionally
uses the least of.

---

Adapted from the reference implementation's documentation (openclaw/openclaw#101136 series).
