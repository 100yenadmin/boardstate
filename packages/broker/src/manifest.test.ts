// The manifest hash is the anti-rug-pull anchor: stable across runs and key order,
// moves iff the callable surface (tool set or an input schema) changes, indifferent to
// description churn. `readOnlyHint` absent ⇒ mutation (fail-safe).

import { describe, expect, it } from "vitest";
import { buildManifest, manifestHash, type DiscoveredTool } from "./manifest.js";

function tools(overrides: Partial<DiscoveredTool>[] = []): Map<string, DiscoveredTool[]> {
  const base: DiscoveredTool[] = [
    {
      name: "list_files",
      description: "List files.",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
      annotations: { readOnlyHint: true },
    },
    {
      name: "write_file",
      description: "Write a file.",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
      // No annotations: must be treated as a mutation.
    },
    ...overrides.map((o) => ({ name: "x", inputSchema: {}, ...o }) as DiscoveredTool),
  ];
  return new Map([["office", base]]);
}

describe("buildManifest", () => {
  it("namespaces every tool and honors readOnlyHint fail-safe", () => {
    const manifest = buildManifest(tools());
    const byId = new Map(manifest.tools.map((t) => [t.id, t]));
    expect(byId.get("office:list_files")?.readOnly).toBe(true);
    // Absent readOnlyHint ⇒ mutation.
    expect(byId.get("office:write_file")?.readOnly).toBe(false);
    expect(byId.get("office:list_files")?.providerName).toBe("office__list_files");
    expect(manifest.providerToId.get("office__write_file")).toBe("office:write_file");
  });

  it("is deterministic and independent of tool discovery order", () => {
    const a = buildManifest(tools());
    const reversed = new Map([["office", [...tools().get("office")!].reverse()]]);
    const b = buildManifest(reversed);
    expect(a.hash).toBe(b.hash);
  });

  it("hash is stable across key-order differences in a schema", () => {
    const s1: DiscoveredTool = {
      name: "t",
      inputSchema: { type: "object", required: ["a"], properties: { a: { type: "string" } } },
    };
    const s2: DiscoveredTool = {
      name: "t",
      inputSchema: { properties: { a: { type: "string" } }, required: ["a"], type: "object" },
    };
    expect(manifestHash(buildManifest(new Map([["c", [s1]]])).tools)).toBe(
      manifestHash(buildManifest(new Map([["c", [s2]]])).tools),
    );
  });

  it("hash does NOT move on description-only changes", () => {
    const before = buildManifest(tools());
    const withNewDesc = new Map([
      [
        "office",
        tools()
          .get("office")!
          .map((t) => ({ ...t, description: `${t.description ?? ""} (edited)` })),
      ],
    ]);
    expect(buildManifest(withNewDesc).hash).toBe(before.hash);
  });

  it("hash MOVES when a tool is added, removed, renamed, or a schema changes", () => {
    const base = buildManifest(tools());

    const added = buildManifest(
      new Map([["office", [...tools().get("office")!, { name: "new_tool", inputSchema: {} }]]]),
    );
    expect(added.hash).not.toBe(base.hash);

    const removed = buildManifest(new Map([["office", [tools().get("office")![0]!]]]));
    expect(removed.hash).not.toBe(base.hash);

    const renamed = buildManifest(
      new Map([
        [
          "office",
          tools()
            .get("office")!
            .map((t, i) => (i === 0 ? { ...t, name: "ls" } : t)),
        ],
      ]),
    );
    expect(renamed.hash).not.toBe(base.hash);

    const schemaChanged = buildManifest(
      new Map([
        [
          "office",
          tools()
            .get("office")!
            .map((t, i) =>
              i === 0 ? { ...t, inputSchema: { type: "object", properties: {} } } : t,
            ),
        ],
      ]),
    );
    expect(schemaChanged.hash).not.toBe(base.hash);
  });
});
