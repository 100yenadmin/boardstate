import { describe, expect, it } from "vitest";
import {
  buildWorkspaceExportDoc,
  parseWorkspaceImport,
  sanitizeImportedWorkspace,
  serializeWorkspaceExport,
  workspaceDocFromPayload,
  workspaceExportFilename,
} from "./distribution.js";

function sampleDoc(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    workspaceVersion: 3,
    tabs: [
      {
        slug: "main",
        title: "Main",
        hidden: false,
        createdBy: "user",
        widgets: [
          {
            id: "w1",
            kind: "builtin:markdown",
            grid: { x: 0, y: 0, w: 6, h: 2 },
            collapsed: false,
            hidden: false,
          },
          {
            id: "w2",
            kind: "custom:charts",
            grid: { x: 6, y: 0, w: 6, h: 2 },
            collapsed: false,
            hidden: false,
          },
        ],
      },
      {
        slug: "ops",
        title: "Ops",
        hidden: false,
        createdBy: "user",
        widgets: [
          {
            id: "w3",
            kind: "custom:pager",
            grid: { x: 0, y: 0, w: 4, h: 2 },
            collapsed: false,
            hidden: false,
          },
        ],
      },
    ],
    widgetsRegistry: {
      charts: { status: "approved", createdBy: "agent:a", approvedBy: "user", approvedAt: "t" },
      pager: { status: "approved", createdBy: "user" },
    },
    prefs: { tabOrder: ["main", "ops"] },
  };
}

describe("workspaceDocFromPayload", () => {
  it("prefers .doc, then .workspace, then the bare payload", () => {
    expect(workspaceDocFromPayload({ doc: { tabs: [] }, workspaceVersion: 1 })).toEqual({
      tabs: [],
    });
    expect(workspaceDocFromPayload({ workspace: { tabs: [1] } })).toEqual({ tabs: [1] });
    expect(workspaceDocFromPayload({ tabs: [2] })).toEqual({ tabs: [2] });
    expect(workspaceDocFromPayload(null)).toEqual({});
  });
});

describe("workspaceExportFilename", () => {
  it("is a stable, filesystem-safe json name", () => {
    const name = workspaceExportFilename(new Date("2026-07-08T12:00:00.000Z"));
    expect(name).toBe("dashboard-workspace-2026-07-08T12-00-00-000Z.json");
  });
});

describe("buildWorkspaceExportDoc", () => {
  it("returns the full workspace when no subset is given", () => {
    expect(buildWorkspaceExportDoc(sampleDoc())).toEqual(sampleDoc());
  });

  it("filters to a tab subset and prunes tabOrder + registry", () => {
    const exported = buildWorkspaceExportDoc(sampleDoc(), { slugs: ["main"] });
    const tabs = exported.tabs as Array<{ slug: string }>;
    expect(tabs.map((tab) => tab.slug)).toEqual(["main"]);
    expect((exported.prefs as { tabOrder: string[] }).tabOrder).toEqual(["main"]);
    // `charts` is referenced by `main`; `pager` (only on the dropped `ops` tab) is gone.
    expect(Object.keys(exported.widgetsRegistry as object)).toEqual(["charts"]);
  });

  it("does not mutate the source doc", () => {
    const doc = sampleDoc();
    buildWorkspaceExportDoc(doc, { slugs: ["main"] });
    expect((doc.tabs as unknown[]).length).toBe(2);
  });
});

describe("serializeWorkspaceExport", () => {
  it("emits pretty JSON with a trailing newline", () => {
    const json = serializeWorkspaceExport({ a: 1 });
    expect(json).toBe('{\n  "a": 1\n}\n');
  });
});

describe("parseWorkspaceImport", () => {
  it("parses valid JSON and throws a friendly error otherwise", () => {
    expect(parseWorkspaceImport('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseWorkspaceImport("{not json")).toThrow(/valid JSON/);
  });
});

describe("sanitizeImportedWorkspace", () => {
  it("forces every custom widget to pending and drops approval provenance", () => {
    const sanitized = sanitizeImportedWorkspace(sampleDoc());
    const registry = sanitized.widgetsRegistry as Record<string, Record<string, unknown>>;
    expect(registry.charts).toEqual({ status: "pending", createdBy: "agent:a" });
    expect(registry.pager).toEqual({ status: "pending", createdBy: "user" });
  });

  it("seeds a pending entry for a custom widget with no registry entry", () => {
    const doc = sampleDoc();
    doc.widgetsRegistry = {};
    const sanitized = sanitizeImportedWorkspace(doc);
    const registry = sanitized.widgetsRegistry as Record<string, Record<string, unknown>>;
    expect(registry.charts).toEqual({ status: "pending", createdBy: "user" });
    expect(registry.pager).toEqual({ status: "pending", createdBy: "user" });
  });

  it("rejects a non-object import", () => {
    expect(() => sanitizeImportedWorkspace([])).toThrow(/workspace object/);
    expect(() => sanitizeImportedWorkspace("nope")).toThrow(/workspace object/);
  });

  it("re-pends a granted tools grant to requested and keeps the tools snapshot (§17.1)", () => {
    // An imported board is foreign authoring — it carries NO active tool grant, so a
    // `granted` tools grant re-pends (mirrors the reconcile anti-rug-pull direction).
    const doc = sampleDoc();
    doc.capabilitiesRegistry = {
      officecli: {
        status: "granted",
        methods: [],
        streams: [],
        tools: ["officecli:send_mail"],
        toolsHash: "hash-x",
        grantedBy: "user",
        grantedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const sanitized = sanitizeImportedWorkspace(doc);
    const caps = sanitized.capabilitiesRegistry as Record<string, Record<string, unknown>>;
    expect(caps.officecli).toEqual({
      status: "requested",
      methods: [],
      streams: [],
      tools: ["officecli:send_mail"],
      toolsHash: "hash-x",
    });
  });

  it("round-trips a workspace through export → parse → sanitize (custom widgets pending)", () => {
    const json = serializeWorkspaceExport(sampleDoc());
    const sanitized = sanitizeImportedWorkspace(parseWorkspaceImport(json));
    expect((sanitized.tabs as unknown[]).length).toBe(2);
    const registry = sanitized.widgetsRegistry as Record<string, { status: string }>;
    expect(registry.charts!.status).toBe("pending");
    expect(registry.pager!.status).toBe("pending");
  });
});
