// Epic #37 invariant #7 (the additive claim, TESTED not asserted): a board that uses
// NONE of the M5 surface — tool grants (`tools`/`toolsHash`), `builtin:action-button`,
// action-form `mode:"tool"`, or `source:"mcp"` bindings — behaves BYTE-IDENTICALLY
// after the M5 schema train. We run a corpus of pre-M5 docs through the real
// validate (@boardstate/schema) + normalize (queries.ts) paths and prove:
//   1. every doc still VALIDATES (accepted verdict unchanged),
//   2. validate + normalize are IDEMPOTENT (stable output),
//   3. NO new M5 field ever appears in the output (no field is invented on old docs),
//   4. known-bad pre-M5 docs still REJECT (rejected verdicts unchanged).
// Named in the adversarial-invariant-verify for this train.

import { describe, expect, it } from "vitest";
import { DEFAULT_DASHBOARD_WORKSPACE, validateWorkspaceDoc } from "@boardstate/schema";
import { WIDGET_CATALOG } from "./widget-catalog.js";
import { normalizeWorkspace } from "./queries.js";

// A rich pre-M5 board: a granted data-source capability (methods + streams, NO
// tools), plus every pre-M5 binding source. Nothing here touches M5 surface.
const RICH_PRE_M5_DOC = {
  schemaVersion: 1,
  workspaceVersion: 7,
  tabs: [
    {
      slug: "ops",
      title: "Ops",
      hidden: false,
      createdBy: "agent:main",
      widgets: [
        {
          id: "cost",
          kind: "builtin:stat-card",
          title: "Cost",
          grid: { x: 0, y: 0, w: 4, h: 2 },
          collapsed: false,
          hidden: false,
          bindings: {
            live: { source: "rpc", method: "usage.cost" },
            snap: { source: "static", value: { a: 1 } },
            file: { source: "file", path: "reports/day.json", pointer: "/total" },
            feed: { source: "stream", event: "presence", pointer: "/online" },
            total: { source: "computed", op: "sum", inputs: ["snap"] },
          },
          props: { format: "usd" },
        },
      ],
    },
  ],
  widgetsRegistry: {
    charts: { status: "approved", createdBy: "agent:main", approvedBy: "user", approvedAt: "t" },
  },
  capabilitiesRegistry: {
    "prod-db": {
      status: "granted",
      methods: ["usage.cost", "sessions.list"],
      streams: ["presence"],
      description: "prod metrics",
      grantedBy: "user",
      grantedAt: "2026-07-01T00:00:00.000Z",
    },
  },
  prefs: { tabOrder: ["ops"] },
};

/** Wrap a catalog example widget in a minimal single-tab doc. */
function docWith(widget: unknown) {
  return {
    schemaVersion: 1,
    workspaceVersion: 1,
    tabs: [{ slug: "t", title: "T", hidden: false, createdBy: "system", widgets: [widget] }],
    widgetsRegistry: {},
    prefs: { tabOrder: ["t"] },
  };
}

// Pre-M5 corpus: the default seed, the rich doc, and every catalog example EXCEPT
// M5 surface (the action-button entry and the action-form tool-mode variant).
const PRE_M5_CORPUS: unknown[] = [
  DEFAULT_DASHBOARD_WORKSPACE,
  RICH_PRE_M5_DOC,
  ...WIDGET_CATALOG.filter((entry) => entry.kind !== "builtin:action-button").map((entry) =>
    docWith(entry.example),
  ),
];

// Keys / discriminants introduced by the M5 train. None may appear in the output of
// a pre-M5 doc.
const M5_FIELD_KEYS = ["tools", "toolsHash", "mode", "connector", "tool", "args", "argsFrom"];

function assertNoM5Surface(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, i) => assertNoM5Surface(entry, `${path}[${i}]`));
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of M5_FIELD_KEYS) {
    expect(key in record, `${path}.${key} (M5 field leaked onto a pre-M5 doc)`).toBe(false);
  }
  if (record.source === "mcp") {
    throw new Error(`${path}.source became "mcp" on a pre-M5 doc`);
  }
  if (record.kind === "builtin:action-button") {
    throw new Error(`${path}.kind became action-button on a pre-M5 doc`);
  }
  for (const [key, entry] of Object.entries(record)) {
    assertNoM5Surface(entry, `${path}.${key}`);
  }
}

describe("M5 additive claim — pre-M5 docs behave byte-identically", () => {
  it("every pre-M5 doc still validates (accepted verdicts unchanged) and is idempotent", () => {
    for (const doc of PRE_M5_CORPUS) {
      const once = validateWorkspaceDoc(doc);
      const twice = validateWorkspaceDoc(once);
      expect(twice).toEqual(once);
    }
  });

  it("validate invents no M5 field on any pre-M5 doc", () => {
    for (const doc of PRE_M5_CORPUS) {
      assertNoM5Surface(validateWorkspaceDoc(doc), "validated");
    }
  });

  it("normalize invents no M5 field on any pre-M5 doc, and is idempotent", () => {
    for (const doc of PRE_M5_CORPUS) {
      const once = normalizeWorkspace(doc);
      assertNoM5Surface(once, "normalized");
      // Round-trip: normalizing an already-normalized doc is a fixed point.
      expect(normalizeWorkspace(once)).toEqual(once);
    }
  });

  it("still rejects the pre-M5 invalid docs it always rejected", () => {
    // Bad tab slug, non-allowlisted rpc method, and grid overflow — the verdicts
    // must be unchanged by the additive train.
    expect(() =>
      validateWorkspaceDoc({
        ...RICH_PRE_M5_DOC,
        tabs: [{ ...RICH_PRE_M5_DOC.tabs[0], slug: "Bad Slug" }],
      }),
    ).toThrow();
    const badRpc = structuredClone(RICH_PRE_M5_DOC);
    badRpc.tabs[0]!.widgets[0]!.bindings.live = { source: "rpc", method: "secrets.read" } as never;
    expect(() => validateWorkspaceDoc(badRpc)).toThrow("not allowlisted");
    const overflow = structuredClone(RICH_PRE_M5_DOC);
    overflow.tabs[0]!.widgets[0]!.grid = { x: 10, y: 0, w: 4, h: 2 };
    expect(() => validateWorkspaceDoc(overflow)).toThrow("x + w");
  });
});
