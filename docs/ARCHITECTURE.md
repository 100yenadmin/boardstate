# Architecture

Where [SPEC.md](../packages/schema/SPEC.md) defines the _protocol_ (the wire contract any host must honor), this document describes the _reference implementation_ — how the packages layer, what the seams are, and how you build a new host on top.

## The one idea

A dashboard is a **document**. Everything else is a consequence:

- Editing = mutating the document through one validated control plane. Agents, humans, and scripts share it; there is no privileged path.
- Rendering = a pure function of the document.
- Persistence, undo, export/import, time-travel, templates = operations on a document, for free.
- Safety = the document names _which_ foreign widgets may run, and the runtime refuses to mount any that an operator hasn't approved.

## Package graph

```
                 ┌─────────────────┐
                 │      schema      │  document types · validators · the SPEC
                 └────────┬─────────┘  (zero deps)
                          │
                 ┌────────┴─────────┐
                 │       core       │  DashboardStore · bindings · grid · queries
                 └───┬────────┬─────┘  transforms · pub/sub · history   (zero deps)
        ┌────────────┘        └────────────┐
   ┌────┴─────┐                       ┌─────┴────┐
   │  server  │  dashboard.* control  │   host   │  sandbox mount · bridge v1
   └────┬─────┘  plane · tools · CLI  └─────┬────┘  transport client store  (DOM)
        │        · widget serving           │
        │                             ┌─────┴────┐
   ┌────┴─────┐                       │   lit    │  <boardstate-view> · 15 renderers
   │   mcp    │  any-AI tool server   └─────┬────┘  (peer: lit)
   └──────────┘                       ┌─────┴────┐
                                      │  react   │  typed CE wrappers (peer: react)
                                      └──────────┘

   conformance ── depends on schema+core+server ── the suite you run against your own transport
```

Dependencies only ever point up this graph. `schema` and `core` are **zero-runtime-dependency** by rule — the validators are hand-written on purpose (a validator with a supply chain is a liability in a security-critical path).

## The three seams

Everything host-specific is an injected interface, so the same logic runs in a browser, on a server, in an MCP process, or inside another product.

| Seam                 | Package | Replaces                                 | Reference impls                                                                 |
| -------------------- | ------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| **`StorageAdapter`** | core    | where the document lives                 | `FsStorageAdapter` (atomic tmp+rename, `~/.boardstate`), `MemoryStorageAdapter` |
| **`Transport`**      | core    | how the client reaches the control plane | `createInProcessHost` (server), an HTTP/WS client, etc.                         |
| **`ServerHost`**     | server  | how the control plane registers itself   | `createInProcessHost`; a real gateway supplies its own                          |

`Transport` is the seam that the [conformance suite](../conformance) exercises — and the one whose contract drift once shipped three P1 bugs in the pre-extraction codebase (see SPEC §12). If you implement it, run the suite.

## Request lifecycle (a mutation)

```
author (agent tool | CLI | UI drag) ──▶ ServerHost.registerRpc handler
   ▶ validate params against the method's allowed-keys whitelist  (unknown key → reject)
   ▶ DashboardStore.mutate under the single-writer queue
       ▶ apply → validateWorkspaceDoc → StorageAdapter.writeFileAtomic → bump workspaceVersion → push undo
   ▶ respondDoc: filterWorkspaceForOperator(doc, identity)   (private tabs stripped for non-owners)
   ▶ broadcast "boardstate.changed" { workspaceVersion, actor }
UI receives the broadcast → refetches (version-gated) → re-renders
```

The store is the sole authority; the write path is serialized and atomic; every response is visibility-filtered; every commit is announced exactly once.

## The custom-widget sandbox (the security spine)

A `custom:` widget is foreign code. The runtime treats it as hostile and gives it nothing:

1. **It doesn't exist until approved.** Scaffolded/imported widgets land `pending`. No iframe is constructed client-side; assets 404 server-side. Approval is an explicit operator act — never automatic.
2. **It has no origin.** `sandbox="allow-scripts"` (never `allow-same-origin`). Message trust is by window identity (`event.source === iframe.contentWindow`), never an origin string.
3. **It has no network.** CSP `connect-src 'none'` makes this structural, not conventional. All data arrives from the trusted parent, which resolves only the bindings the widget's manifest declared.
4. **It can't reach the gateway.** The parent brokers everything over the postMessage bridge; prompt dispatch crosses a single operator-confirm + rate-limit gate.

These are the normative invariants in SPEC §11, and they're what the [adversarial verification pass](../CONTRIBUTING.md) targets on every change to this surface.

## Building a new host

The minimum: implement a `Transport` (wrap `@boardstate/server`'s in-process host, or bridge your own RPC), a `StorageAdapter`, and mount `<boardstate-view>` (or the React wrapper, or your own renderer against `@boardstate/core`). Then `runTransportConformance(makeTransport)` from `@boardstate/conformance` — if it's green, your host speaks the protocol. That's the whole contract; everything else is yours to shape.
