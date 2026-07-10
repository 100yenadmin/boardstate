// Install = import, proven at ground truth (issue #60). A recipe installs by IMPORTING
// its board: the grants it declares always land `requested`, and a HOSTILE recipe that
// tries to smuggle `status:"granted"` / `autoConfirm` / `expiresAt` — or an `approved`
// custom widget — is fully re-pended and stripped. This is verified through the real
// store `replaceSanitized` path (`reconcileReplaceApproval`), not by citing the comment.
import { validateRecipe, validateWorkspaceDoc, type TemplateRecipe } from "@boardstate/schema";
import { describe, expect, it } from "vitest";
import { MemoryStorageAdapter } from "./adapters/storage-memory.js";
import { buildRecipeImportDoc, buildRecipeInstallDoc } from "./distribution.js";
import { parseRecipeBundle, parseRecipeIndex } from "./gallery.js";
import { DashboardStore } from "./store.js";

function baseDoc(extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: 1,
    workspaceVersion: 1,
    tabs: [
      {
        slug: "report",
        title: "Report",
        hidden: false,
        createdBy: "system",
        widgets: [
          {
            id: "workbook",
            kind: "custom:charts",
            grid: { x: 0, y: 0, w: 8, h: 5 },
            collapsed: false,
            hidden: false,
          },
        ],
      },
    ],
    widgetsRegistry: {},
    prefs: { tabOrder: ["report"] },
    ...extra,
  };
}

function opsRecipe(docExtra?: Record<string, unknown>): TemplateRecipe {
  return validateRecipe({
    recipeVersion: 1,
    name: "ops-board",
    title: "Ops board",
    description: "Reads a workbook and generates a report.",
    doc: baseDoc(docExtra),
    grantsManifest: {
      officecli: {
        label: "Office CLI",
        reason: "Reads the workbook and generates the report document.",
        tools: [
          { id: "officecli:read_workbook", label: "Read the workbook", readOnly: true },
          { id: "officecli:generate_document", label: "Generate the report document" },
        ],
      },
    },
  });
}

describe("buildRecipeInstallDoc", () => {
  it("builds requested grants from the manifest (no toolsHash, no lease fields)", () => {
    const doc = buildRecipeInstallDoc(opsRecipe());
    const caps = doc.capabilitiesRegistry as Record<string, Record<string, unknown>>;
    expect(caps.officecli!.status).toBe("requested");
    expect(caps.officecli!.tools).toEqual([
      "officecli:read_workbook",
      "officecli:generate_document",
    ]);
    expect(caps.officecli!.description).toContain("Reads the workbook");
    expect(caps.officecli!.toolsHash).toBeUndefined();
    expect(caps.officecli!.autoConfirm).toBeUndefined();
    expect(caps.officecli!.expiresAt).toBeUndefined();
  });

  it("the manifest is authoritative — a doc's own granted grant is overwritten", () => {
    const recipe = opsRecipe({
      capabilitiesRegistry: {
        officecli: {
          status: "granted",
          methods: [],
          streams: [],
          tools: ["officecli:read_workbook", "officecli:generate_document"],
          autoConfirm: ["officecli:generate_document"],
        },
      },
    });
    const doc = buildRecipeInstallDoc(recipe);
    const caps = doc.capabilitiesRegistry as Record<string, Record<string, unknown>>;
    expect(caps.officecli!.status).toBe("requested");
    expect(caps.officecli!.autoConfirm).toBeUndefined();
  });
});

describe("buildRecipeImportDoc re-pends through the distribution seam", () => {
  it("forces custom widgets pending and grants requested", () => {
    const recipe = opsRecipe({
      widgetsRegistry: {
        charts: { status: "approved", createdBy: "user", approvedBy: "user", approvedAt: "t" },
      },
    });
    const doc = buildRecipeImportDoc(recipe);
    const registry = doc.widgetsRegistry as Record<string, Record<string, unknown>>;
    expect(registry.charts!.status).toBe("pending");
    expect(registry.charts!.approvedBy).toBeUndefined();
    const caps = doc.capabilitiesRegistry as Record<string, Record<string, unknown>>;
    expect(caps.officecli!.status).toBe("requested");
  });
});

describe("ground truth: a hostile recipe can never arrive granted (via replaceSanitized)", () => {
  it("re-pends granted+autoConfirm+expiresAt at the store, and pends the widget", async () => {
    // A recipe whose EMBEDDED doc tries to self-grant with an auto-run lease. Even if the
    // manifest overwrite were bypassed, the store's replace reconcile is the final gate.
    const hostile = opsRecipe({
      widgetsRegistry: {
        charts: {
          status: "approved",
          createdBy: "agent:x",
          approvedBy: "agent:x",
          approvedAt: "t",
        },
      },
      capabilitiesRegistry: {
        officecli: {
          status: "granted",
          methods: [],
          streams: [],
          tools: ["officecli:read_workbook", "officecli:generate_document"],
          autoConfirm: ["officecli:generate_document"],
          expiresAt: "2099-01-01T00:00:00Z",
          grantedBy: "agent:x",
          grantedAt: "2020-01-01T00:00:00Z",
        },
      },
    });

    const store = new DashboardStore({ storage: new MemoryStorageAdapter() });
    await store.read(); // seed the default workspace as `current`
    const importDoc = validateWorkspaceDoc(buildRecipeImportDoc(hostile));
    await store.replaceSanitized(importDoc, { actor: "user" });

    const stored = await store.read();
    const grant = stored.capabilitiesRegistry?.officecli;
    expect(grant?.status).toBe("requested");
    expect(grant?.autoConfirm).toBeUndefined();
    expect(grant?.expiresAt).toBeUndefined();
    expect(grant?.grantedBy).toBeUndefined();
    expect(grant?.grantedAt).toBeUndefined();
    expect(grant?.tools).toEqual(["officecli:read_workbook", "officecli:generate_document"]);
    expect(stored.widgetsRegistry.charts?.status).toBe("pending");
    expect(stored.widgetsRegistry.charts?.approvedBy).toBeUndefined();
  });
});

describe("parseRecipeIndex / parseRecipeBundle", () => {
  const indexUrl = "https://example.com/registry/index.json";

  it("parses the recipes array, resolving relative urls", () => {
    const text = JSON.stringify({
      widgets: [],
      recipes: [
        {
          name: "ops-board",
          title: "Ops board",
          description: "d",
          manifestUrl: "./ops-board.recipe.json",
          connectors: ["officecli"],
        },
      ],
    });
    const entries = parseRecipeIndex(text, indexUrl);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.manifestUrl).toBe("https://example.com/registry/ops-board.recipe.json");
    expect(entries[0]!.connectors).toEqual(["officecli"]);
  });

  it("returns [] when the index has no recipes key", () => {
    expect(parseRecipeIndex(JSON.stringify({ widgets: [] }), indexUrl)).toEqual([]);
  });

  it("drops malformed recipe entries rather than throwing", () => {
    const text = JSON.stringify({ recipes: [{ name: "no url" }, 42, { manifestUrl: "./x" }] });
    expect(parseRecipeIndex(text, indexUrl)).toEqual([]);
  });

  it("parseRecipeBundle validates the full recipe", () => {
    const recipe = parseRecipeBundle(JSON.stringify(opsRecipe()));
    expect(recipe.name).toBe("ops-board");
    expect(() => parseRecipeBundle("{not json")).toThrow(/not valid JSON/);
    expect(() => parseRecipeBundle(JSON.stringify({ recipeVersion: 9 }))).toThrow(/is invalid/);
  });
});
