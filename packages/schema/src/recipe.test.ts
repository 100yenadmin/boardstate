import { describe, expect, it } from "vitest";
import { CURRENT_RECIPE_VERSION, recipeConnectors, validateRecipe } from "./recipe.js";

function sampleDoc(): Record<string, unknown> {
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
            kind: "builtin:table",
            grid: { x: 0, y: 0, w: 8, h: 5 },
            collapsed: false,
            hidden: false,
            bindings: { value: { source: "mcp", connector: "officecli", tool: "read_workbook" } },
            props: { columns: ["quarter", "revenue"] },
          },
        ],
      },
    ],
    widgetsRegistry: {},
    prefs: { tabOrder: ["report"] },
  };
}

function sampleRecipe(): Record<string, unknown> {
  return {
    recipeVersion: 1,
    name: "ops-board",
    title: "Ops board",
    description: "A board that reads a workbook and generates a report.",
    doc: sampleDoc(),
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
  };
}

describe("validateRecipe", () => {
  it("accepts a well-formed recipe and normalizes it", () => {
    const recipe = validateRecipe(sampleRecipe());
    expect(recipe.recipeVersion).toBe(CURRENT_RECIPE_VERSION);
    expect(recipe.name).toBe("ops-board");
    expect(recipe.doc.tabs[0]!.slug).toBe("report");
    expect(recipeConnectors(recipe)).toEqual(["officecli"]);
    expect(recipe.grantsManifest.officecli!.tools).toHaveLength(2);
  });

  it("accepts a recipe with no grants (a pure template)", () => {
    const raw = sampleRecipe();
    delete raw.grantsManifest;
    const recipe = validateRecipe(raw);
    expect(recipe.grantsManifest).toEqual({});
    expect(recipeConnectors(recipe)).toEqual([]);
  });

  it("runs the embedded doc through the workspace validator", () => {
    const raw = sampleRecipe();
    (raw.doc as { schemaVersion: number }).schemaVersion = 2;
    expect(() => validateRecipe(raw)).toThrow(/schemaVersion/);
  });

  it("rejects an unknown recipeVersion", () => {
    expect(() => validateRecipe({ ...sampleRecipe(), recipeVersion: 2 })).toThrow(/recipeVersion/);
  });

  it("rejects a grant tool id not namespaced under its connector", () => {
    const raw = sampleRecipe();
    (
      raw.grantsManifest as Record<string, { tools: { id: string; label: string }[] }>
    ).officecli!.tools[0]!.id = "otherconn:read_workbook";
    expect(() => validateRecipe(raw)).toThrow(/namespaced under connector/);
  });

  it("rejects a malformed grant tool id", () => {
    const raw = sampleRecipe();
    (
      raw.grantsManifest as Record<string, { tools: { id: string; label: string }[] }>
    ).officecli!.tools[0]!.id = "officecli read_workbook";
    expect(() => validateRecipe(raw)).toThrow(/connector:tool id/);
  });

  it("rejects a connector grant that requests nothing", () => {
    const raw = sampleRecipe();
    (raw.grantsManifest as Record<string, unknown>).officecli = { label: "Office CLI" };
    expect(() => validateRecipe(raw)).toThrow(/at least one tool, method, or stream/);
  });

  it("rejects duplicate tool ids within a connector", () => {
    const raw = sampleRecipe();
    const grant = (raw.grantsManifest as Record<string, { tools: { id: string; label: string }[] }>)
      .officecli!;
    grant.tools[1]!.id = grant.tools[0]!.id;
    expect(() => validateRecipe(raw)).toThrow(/duplicate tool ids/);
  });

  it("rejects unknown top-level keys", () => {
    expect(() => validateRecipe({ ...sampleRecipe(), extra: 1 })).toThrow(/not allowed/);
  });
});
