# Security Policy

Boardstate's core claim is that **agent-authored widgets are safe to run by construction**. The normative security invariants (I1–I8) are specified in [SPEC.md §11](packages/schema/SPEC.md) — opaque-origin sandboxing, structural no-network CSP, the approval gate, jailed serving, the single prompt-dispatch gate, server-side private-tab filtering, tab-scoped pub/sub, and the single validated store.

## Reporting a vulnerability

If you find a way to violate any of those invariants — a sandbox escape, an approval bypass, a containment break, cross-tab leakage, or anything that lets a widget act beyond its manifest — please report it privately via [GitHub Security Advisories](../../security/advisories/new) rather than a public issue.

You can expect an acknowledgment within a few days. Please include a minimal reproduction (a `workspace.json` + widget directory is usually enough).

## Scope notes

- The **reference CSP and serving rules are normative** for the reference host; weakening them in a fork is a host decision, not a Boardstate vulnerability.
- The `iframe-embed` **builtin** intentionally embeds operator-chosen URLs under host policy (`sandboxMode`, `allowExternalUrls`) — misuse of an intentionally-permissive host config is out of scope.
- Denial-of-service via oversized documents is bounded by the spec'd limits (256 KB doc / 64 KB widget state / 8 KB static bindings); reports that respect those limits but still break availability are in scope.
