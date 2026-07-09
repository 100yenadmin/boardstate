// The reusable Boardstate transport-conformance suite.
//
// `runTransportConformance(makeTransport)` registers a `describe`/`it` tree that a
// host wires against its OWN transport (the seam a real client drives: `request` +
// `addEventListener`). It is the productized form of the wire-contract lesson
// (SPEC §12): a real client is driven against a real host over the host's real
// transport, pinning the exact wire shapes that shipped broken green when each
// side was only unit-tested against a mock of the other.
//
// Discipline (SPEC §2): fixtures seed ONLY over the transport itself
// (`dashboard.workspace.replace`); assertions read back via
// `dashboard.workspace.get`. The suite is host-agnostic — no fs, no node
// specifics beyond what vitest itself needs — so any conformant host can run it.

import { describe, expect, it } from "vitest";
import type { Transport } from "@boardstate/core";
import {
  CHAT_EVENT,
  validateWorkspaceDoc,
  type AgentStreamEvent,
  type WorkspaceDoc,
} from "@boardstate/schema";
import {
  customWidgetClaimingApprovedDoc as customWidgetClaimingApproved,
  oneTabDoc as oneTab,
} from "./fixtures.js";

/** A transport plus the teardown for whatever backs it (temp dir, process, …). */
export interface TransportHarness {
  transport: Transport;
  teardown(): Promise<void>;
}

/** Builds a fresh, isolated host+transport. Called once per `it` for isolation. */
export type MakeTransport = () => Promise<TransportHarness>;

/**
 * Three operator-scoped transports over a SINGLE shared host — required only for
 * the §11-I6 history-visibility assertion, which needs one operator to author a
 * private tab and a different (and an unidentified) operator to read it back out
 * of history. `a`/`b` carry distinct operator identities; `unidentified` carries
 * none (fail-closed). Omit `operators` from the options to skip that assertion.
 */
export interface OperatorHarness {
  a: Transport;
  b: Transport;
  unidentified: Transport;
  teardown(): Promise<void>;
}

export interface TransportConformanceOptions {
  /** Opt-in extension surfaces (SPEC §4 "Extensions", §10). Absent ⇒ skipped. */
  extensions?: { widgetState?: boolean; history?: boolean };
  /** Operator-scoped transports for the §11-I6 history-visibility assertion. */
  operators?: () => Promise<OperatorHarness>;
  /**
   * Opt-in chat & agent-turn protocol assertions (SPEC §14). Requires the transport
   * to register `chat.send` (a host with an agent loop). Absent ⇒ skipped, so a host
   * with no agent loop is not forced to implement one.
   */
  chat?: boolean;
}

type Envelope = { doc: WorkspaceDoc; workspaceVersion: number };

function getDoc(transport: Transport): Promise<Envelope> {
  return transport.request("dashboard.workspace.get", {}) as Promise<Envelope>;
}

function findWidget(doc: WorkspaceDoc, slug: string, id: string) {
  const widget = doc.tabs.find((tab) => tab.slug === slug)?.widgets.find((w) => w.id === id);
  if (!widget) {
    throw new Error(`widget ${id} not found on tab ${slug}`);
  }
  return widget;
}

/** Assert a request rejects with a specific wire error `code` (SPEC §6). */
async function rejectsWithCode(promise: Promise<unknown>, code: string): Promise<void> {
  let error: unknown;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expect(error, `expected a rejection with code ${code}`).toBeInstanceOf(Error);
  expect((error as { code?: string }).code).toBe(code);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drive one chat turn over a transport: subscribe to `CHAT_EVENT`, `chat.send`, and
 * collect this session's events until `turn-end` (or a safety timeout). When `abort`
 * is set, fire `chat.abort` immediately after `chat.send` to exercise mid-turn cancel.
 */
async function collectChatTurn(
  transport: Transport,
  sessionKey: string,
  message: string,
  opts: { abort?: boolean } = {},
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const unsubscribe = transport.addEventListener(CHAT_EVENT, (payload) => {
    const event = payload as AgentStreamEvent;
    if (event.sessionKey !== sessionKey) {
      return;
    }
    events.push(event);
    if (event.type === "turn-end") {
      resolveDone();
    }
  });
  try {
    const { turnId } = (await transport.request("chat.send", { sessionKey, message })) as {
      turnId: string;
    };
    if (opts.abort) {
      await transport.request("chat.abort", { sessionKey, turnId });
    }
    await Promise.race([done, sleep(3000)]);
  } finally {
    unsubscribe();
  }
  return events;
}

/** Every text block is a matched start → delta* → end triad (open blocks allowed only on abort). */
function assertTextTriads(events: AgentStreamEvent[], aborted: boolean): void {
  const open = new Set<string>();
  for (const event of events) {
    if (event.type === "text-start") {
      expect(open.has(event.id), "duplicate text-start id").toBe(false);
      open.add(event.id);
    } else if (event.type === "text-delta") {
      expect(open.has(event.id), "text-delta outside its block").toBe(true);
    } else if (event.type === "text-end") {
      expect(open.has(event.id), "text-end without a start").toBe(true);
      open.delete(event.id);
    }
  }
  if (!aborted) {
    expect(open.size, "unmatched text-start on a non-aborted turn").toBe(0);
  }
}

/** `tool-call-ready` precedes its `tool-result`; every result names a started+ready call. */
function assertToolOrdering(events: AgentStreamEvent[]): void {
  const started = new Set<string>();
  const ready = new Set<string>();
  for (const event of events) {
    if (event.type === "tool-call-start") {
      started.add(event.callId);
    } else if (event.type === "tool-call-delta") {
      expect(started.has(event.callId), "tool-call-delta before its start").toBe(true);
    } else if (event.type === "tool-call-ready") {
      expect(started.has(event.callId), "tool-call-ready before its start").toBe(true);
      ready.add(event.callId);
    } else if (event.type === "tool-result") {
      expect(ready.has(event.callId), "tool-result before its tool-call-ready").toBe(true);
    }
  }
}

export function runTransportConformance(
  makeTransport: MakeTransport,
  opts: TransportConformanceOptions = {},
): void {
  /** Run `fn` against a fresh transport, always tearing it down. */
  async function withTransport(fn: (transport: Transport) => Promise<void>): Promise<void> {
    const harness = await makeTransport();
    try {
      await fn(harness.transport);
    } finally {
      await harness.teardown();
    }
  }

  /** Seed a doc over the transport itself (never touching a store directly). */
  async function seed(transport: Transport, doc: WorkspaceDoc): Promise<void> {
    await transport.request("dashboard.workspace.replace", { doc });
  }

  describe("Boardstate transport conformance", () => {
    it("§4 envelope: workspace.get responds { doc, workspaceVersion } and doc validates", async () => {
      await withTransport(async (transport) => {
        await seed(transport, oneTab());
        const envelope = await getDoc(transport);
        expect(typeof envelope.workspaceVersion).toBe("number");
        // The doc round-trips through the canonical schema validator unchanged.
        expect(() => validateWorkspaceDoc(envelope.doc)).not.toThrow();
        expect(findWidget(envelope.doc, "ops", "revenue-card").title).toBe("Revenue");
      });
    });

    it("§4 mutation shape: { tab, id, patch } round-trips; legacy { slug, widgetId } errors and never mutates", async () => {
      await withTransport(async (transport) => {
        await seed(transport, oneTab());

        // The shipped P1: the drifted `{ slug, widgetId, collapsed }` shape must be
        // rejected at the wire AND leave the persisted widget untouched.
        await expect(
          transport.request("dashboard.widget.update", {
            slug: "ops",
            widgetId: "revenue-card",
            collapsed: true,
          }),
        ).rejects.toThrow(/unexpected param: slug/);
        expect(findWidget((await getDoc(transport)).doc, "ops", "revenue-card").collapsed).toBe(
          false,
        );

        // The spec shape `{ tab, id, patch }` round-trips into the persisted doc.
        await transport.request("dashboard.widget.update", {
          tab: "ops",
          id: "revenue-card",
          patch: { collapsed: true },
        });
        expect(findWidget((await getDoc(transport)).doc, "ops", "revenue-card").collapsed).toBe(
          true,
        );
      });
    });

    it("§4/§6 data.read: { binding } envelope resolves server-side; rpc bindings are client-resolved", async () => {
      await withTransport(async (transport) => {
        // A server-resolvable binding flows under `{ binding }` and returns `{ data }`.
        const resolved = (await transport.request("dashboard.data.read", {
          binding: { source: "static", value: 7 },
        })) as { data: unknown };
        expect(resolved.data).toBe(7);

        // An `rpc` binding MUST be rejected by the server (SPEC §6): it is resolved
        // by the Control-UI client, never server-side.
        await rejectsWithCode(
          transport.request("dashboard.data.read", {
            binding: { source: "rpc", method: "usage.cost" },
          }),
          "binding_client_resolved",
        );
      });
    });

    it("§8.2 import→pending: replace claiming approved lands pending; only widget.approve yields approved", async () => {
      await withTransport(async (transport) => {
        await seed(transport, customWidgetClaimingApproved("my-widget"));

        // The agent-sanitized replace path forces the claimed-approved entry back to
        // pending and strips its provenance (SPEC §8.2).
        let entry = (await getDoc(transport)).doc.widgetsRegistry["my-widget"];
        expect(entry?.status).toBe("pending");
        expect(entry?.approvedBy).toBeUndefined();
        expect(entry?.approvedAt).toBeUndefined();

        // The ONLY transition to approved is an explicit operator decision.
        await transport.request("dashboard.widget.approve", {
          name: "my-widget",
          decision: "approved",
        });
        entry = (await getDoc(transport)).doc.widgetsRegistry["my-widget"];
        expect(entry?.status).toBe("approved");
      });
    });

    it("§4 approve flow: approve → approved, reject → rejected, invalid name errors", async () => {
      await withTransport(async (transport) => {
        await seed(transport, customWidgetClaimingApproved("my-widget"));

        await transport.request("dashboard.widget.approve", {
          name: "my-widget",
          decision: "approved",
        });
        expect((await getDoc(transport)).doc.widgetsRegistry["my-widget"]?.status).toBe("approved");

        await transport.request("dashboard.widget.approve", {
          name: "my-widget",
          decision: "rejected",
        });
        expect((await getDoc(transport)).doc.widgetsRegistry["my-widget"]?.status).toBe("rejected");

        // A malformed widget name is rejected. NB: the reference implementation
        // UPSERTS a registry entry for a name absent from the registry rather than
        // erroring, so "unknown name errors" is pinned as invalid-name rejection —
        // the guard the code actually enforces (see manifest note).
        await expect(
          transport.request("dashboard.widget.approve", {
            name: "bad name!",
            decision: "approved",
          }),
        ).rejects.toThrow(/name is invalid/);
      });
    });

    it("§5 change events: exactly one boardstate.changed per mutation, versions strictly increasing", async () => {
      await withTransport(async (transport) => {
        const events: Array<{ workspaceVersion: number; actor?: string }> = [];
        const unsubscribe = transport.addEventListener("boardstate.changed", (payload) => {
          events.push(payload as { workspaceVersion: number; actor?: string });
        });
        try {
          await transport.request("dashboard.tab.create", { title: "One" });
          await transport.request("dashboard.tab.create", { title: "Two" });
          await transport.request("dashboard.tab.create", { title: "Three" });
        } finally {
          unsubscribe();
        }
        expect(events).toHaveLength(3);
        for (let i = 1; i < events.length; i += 1) {
          expect(events[i]!.workspaceVersion).toBeGreaterThan(events[i - 1]!.workspaceVersion);
        }
      });
    });

    it("§3 validation at the wire: over-limit tabs / bad slug / overlapping grid error and never mutate", async () => {
      await withTransport(async (transport) => {
        await seed(transport, oneTab());
        const before = (await getDoc(transport)).workspaceVersion;

        // > 32 tabs.
        const tooManyTabs: WorkspaceDoc = {
          schemaVersion: 1,
          workspaceVersion: 0,
          tabs: Array.from({ length: 33 }, (_unused, index) => ({
            slug: `t${index}`,
            title: "Tab",
            hidden: false,
            createdBy: "user" as const,
            widgets: [],
          })),
          widgetsRegistry: {},
          prefs: { tabOrder: [] },
        };
        await expect(
          transport.request("dashboard.workspace.replace", { doc: tooManyTabs }),
        ).rejects.toThrow();

        // Bad slug.
        const badSlug = oneTab();
        badSlug.tabs[0]!.slug = "Bad_Slug";
        badSlug.prefs.tabOrder = [];
        await expect(
          transport.request("dashboard.workspace.replace", { doc: badSlug }),
        ).rejects.toThrow();

        // Overlapping grid (x + w > 12).
        const badGrid = oneTab();
        badGrid.tabs[0]!.widgets[0]!.grid = { x: 10, y: 0, w: 4, h: 2 };
        await expect(
          transport.request("dashboard.workspace.replace", { doc: badGrid }),
        ).rejects.toThrow();

        // None of the rejected replaces committed.
        expect((await getDoc(transport)).workspaceVersion).toBe(before);
      });
    });

    it("§8.2/§11-I3 no elevation via replace: forces pending, strips provenance, keeps already-approved", async () => {
      await withTransport(async (transport) => {
        // A replace claiming approved for a not-currently-approved widget lands
        // pending with provenance stripped.
        await seed(transport, customWidgetClaimingApproved("hub"));
        let entry = (await getDoc(transport)).doc.widgetsRegistry["hub"];
        expect(entry?.status).toBe("pending");
        expect(entry?.approvedBy).toBeUndefined();
        expect(entry?.approvedAt).toBeUndefined();

        // Only widget.approve yields approved.
        await transport.request("dashboard.widget.approve", { name: "hub", decision: "approved" });
        expect((await getDoc(transport)).doc.widgetsRegistry["hub"]?.status).toBe("approved");

        // A subsequent replace that KEEPS the already-approved widget approved must
        // NOT demote it (reconciliation only forces pending on a claimed elevation).
        await seed(transport, customWidgetClaimingApproved("hub"));
        expect((await getDoc(transport)).doc.widgetsRegistry["hub"]?.status).toBe("approved");
      });
    });

    if (opts.extensions?.widgetState) {
      it("§10 widget state: 64KB cap + expectedVersion mismatch both reject whole", async () => {
        await withTransport(async (transport) => {
          // A normal write returns an incrementing version.
          const first = (await transport.request("dashboard.widget.state.set", {
            widgetId: "w1",
            state: { count: 1 },
          })) as { version: number };
          expect(first.version).toBe(1);

          // An expectedVersion that no longer matches rejects the write whole.
          await expect(
            transport.request("dashboard.widget.state.set", {
              widgetId: "w1",
              state: { count: 2 },
              expectedVersion: 0,
            }),
          ).rejects.toThrow();

          // A blob over the 64 KB cap rejects whole (nothing written).
          await expect(
            transport.request("dashboard.widget.state.set", {
              widgetId: "w2",
              state: "x".repeat(70_000),
            }),
          ).rejects.toThrow();
        });
      });
    }

    if (opts.extensions?.history) {
      it("§4 history.list reflects the undo-ring depth", async () => {
        await withTransport(async (transport) => {
          await transport.request("dashboard.tab.create", { title: "One" });
          await transport.request("dashboard.tab.create", { title: "Two" });
          await transport.request("dashboard.tab.create", { title: "Three" });
          const history = (await transport.request("dashboard.workspace.history.list", {})) as {
            entries: Array<{ version: number }>;
          };
          // One undo snapshot per committed mutation (SPEC §3.2 ring).
          expect(history.entries).toHaveLength(3);
        });
      });

      if (opts.operators) {
        it("§11-I6 history.get: a private tab is filtered from a non-owner's (and unidentified) snapshot", async () => {
          const harness = await opts.operators!();
          try {
            // Operator A authors a private tab, then supersedes it with a second
            // mutation so the private tab lives inside a retained history snapshot.
            const created = (await harness.a.request("dashboard.tab.create", {
              title: "Secret",
              visibility: "private",
            })) as { workspaceVersion: number };
            const privateVersion = created.workspaceVersion;
            await harness.a.request("dashboard.tab.create", { title: "Public" });

            const hasPrivate = (doc: WorkspaceDoc) =>
              doc.tabs.some((tab) => tab.visibility === "private");
            const snap = (transport: Transport) =>
              transport.request("dashboard.workspace.history.get", {
                version: privateVersion,
              }) as Promise<{ doc: WorkspaceDoc }>;

            // The owner sees the private tab in the historical snapshot; a different
            // operator and an unidentified caller do not (same filter as live).
            expect(hasPrivate((await snap(harness.a)).doc)).toBe(true);
            expect(hasPrivate((await snap(harness.b)).doc)).toBe(false);
            expect(hasPrivate((await snap(harness.unidentified)).doc)).toBe(false);
          } finally {
            await harness.teardown();
          }
        });
      }
    }

    if (opts.chat) {
      it("§14 turn stream: turn-start first, triads matched, tool-call-ready before its tool-result, one turn-end last", async () => {
        await withTransport(async (transport) => {
          const sessionKey = "conformance-chat";
          const events = await collectChatTurn(transport, sessionKey, "build me a dashboard");

          expect(events.length, "no chat events streamed").toBeGreaterThan(0);
          expect(events[0]!.type, "turn-start must be first").toBe("turn-start");

          const ends = events.filter((event) => event.type === "turn-end");
          expect(ends, "exactly one turn-end").toHaveLength(1);
          expect(events.at(-1)!.type, "turn-end must be last").toBe("turn-end");

          assertTextTriads(events, false);
          assertToolOrdering(events);

          // A real read tool call rode the turn (SPEC §14: names are dashboard.* methods).
          expect(
            events.some(
              (event) => event.type === "tool-call-ready" && event.name.startsWith("dashboard."),
            ),
            "expected at least one dashboard.* tool call in the turn",
          ).toBe(true);

          // history mirrors the stream so a remounted chat view survives (SPEC §14.1).
          const history = (await transport.request("chat.history.get", { sessionKey })) as {
            events: AgentStreamEvent[];
          };
          expect(history.events.some((event) => event.type === "turn-end")).toBe(true);
        });
      });

      it("§14 abort: chat.abort mid-turn yields abort then a single terminal turn-end{aborted}", async () => {
        await withTransport(async (transport) => {
          const events = await collectChatTurn(transport, "conformance-abort", "build me a board", {
            abort: true,
          });

          const ends = events.filter((event) => event.type === "turn-end");
          expect(ends, "exactly one turn-end after abort").toHaveLength(1);
          const last = events.at(-1)!;
          expect(last.type, "turn-end must be last after abort").toBe("turn-end");
          expect(last.type === "turn-end" && last.stopReason).toBe("aborted");
          expect(
            events.some((event) => event.type === "abort"),
            "an abort event must precede the aborted turn-end",
          ).toBe(true);

          // An abort may leave a text block open — that is the ONE exception the triad
          // invariant allows (SPEC §14.2).
          assertTextTriads(events, true);
          assertToolOrdering(events);
        });
      });
    }
  });
}
