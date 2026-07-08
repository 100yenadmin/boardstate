# hello-data

Minimal example: requests one `static` binding (`greeting`) with
`dashboard:getData` on load, and re-renders on both the `dashboard:data`
reply and any later `dashboard:push`.

Swap the `greeting` binding's `source` in `widget.json` to `rpc` (naming an
allowlisted read method) or `file` (naming a logical path under the host's
data dir) to point this at real data instead of a static string — the
`index.html` code doesn't need to change either way, since it only cares
about the `bindingId`, not where the data came from.

See `docs/authoring.md` for the full bridge protocol and manifest schema.

---

Adapted from the reference implementation's documentation (openclaw/openclaw#101136 series).
