// The catalog is only useful if its examples actually mount. These tests keep it
// HONEST: every builtin kind the schema accepts is covered, and every `example` widget
// validates against the real workspace schema — so an agent that copies an example
// always produces a schema-valid, non-empty widget.

import { describe, expect, it } from "vitest";
import { validateWorkspaceDoc } from "@boardstate/schema";
import {
  WIDGET_CATALOG,
  WIDGET_CATALOG_KINDS,
  DATA_SOURCE_WIDGET_KINDS,
} from "./widget-catalog.js";

// The authoritative builtin list (mirrors BUILTIN_KIND_PATTERN in @boardstate/schema).
const ALL_BUILTIN_KINDS = [
  "builtin:stat-card",
  "builtin:markdown",
  "builtin:table",
  "builtin:iframe-embed",
  "builtin:sessions",
  "builtin:usage",
  "builtin:cron",
  "builtin:instances",
  "builtin:activity",
  "builtin:chart",
  "builtin:notes",
  "builtin:action-form",
  "builtin:preview",
  "builtin:agent-status",
  "builtin:approvals",
  "builtin:chat",
];

function docWith(widget: unknown) {
  return {
    schemaVersion: 1,
    workspaceVersion: 1,
    tabs: [
      {
        slug: "t",
        title: "T",
        hidden: false,
        createdBy: "system",
        widgets: [widget],
      },
    ],
    widgetsRegistry: {},
    prefs: { tabOrder: ["t"] },
  };
}

describe("widget catalog", () => {
  it("covers every builtin kind the schema accepts", () => {
    for (const kind of ALL_BUILTIN_KINDS) {
      expect(WIDGET_CATALOG_KINDS).toContain(kind);
    }
    // ...and invents none the schema would reject.
    for (const kind of WIDGET_CATALOG_KINDS) {
      expect(ALL_BUILTIN_KINDS).toContain(kind);
    }
    expect(WIDGET_CATALOG.length + DATA_SOURCE_WIDGET_KINDS.length).toBe(ALL_BUILTIN_KINDS.length);
  });

  it("every full-entry example is schema-valid (a copied example always mounts)", () => {
    for (const entry of WIDGET_CATALOG) {
      expect(entry.example.kind).toBe(entry.kind);
      // The example must survive the same validator every write passes through.
      expect(() => validateWorkspaceDoc(docWith(entry.example))).not.toThrow();
    }
  });

  it("documents the binding keys each example actually uses", () => {
    for (const entry of WIDGET_CATALOG) {
      const exampleBindingKeys = Object.keys(entry.example.bindings ?? {});
      // Every binding the example uses is described in the entry.
      for (const key of exampleBindingKeys) {
        expect(entry.bindings.map((binding) => binding.key)).toContain(key);
      }
    }
  });
});
