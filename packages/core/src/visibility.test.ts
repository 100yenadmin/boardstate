import { DEFAULT_DASHBOARD_WORKSPACE, type WorkspaceDoc } from "@boardstate/schema";
import { describe, expect, it } from "vitest";
import { filterWorkspaceForOperator, isTabVisibleToOperator } from "./visibility.js";

function docWithTabs(): WorkspaceDoc {
  const doc = structuredClone(DEFAULT_DASHBOARD_WORKSPACE) as WorkspaceDoc;
  doc.tabs = [
    { slug: "shared", title: "Shared", hidden: false, createdBy: "user", widgets: [] },
    {
      slug: "a-private",
      title: "A private",
      hidden: false,
      createdBy: "user",
      visibility: "private",
      owner: "device:a",
      widgets: [],
    },
    {
      slug: "b-private",
      title: "B private",
      hidden: false,
      createdBy: "user",
      visibility: "private",
      owner: "device:b",
      widgets: [],
    },
  ];
  doc.prefs = { tabOrder: ["shared", "a-private", "b-private"] };
  return doc;
}

describe("filterWorkspaceForOperator", () => {
  it("hides another operator's private tab and prunes tabOrder", () => {
    const filtered = filterWorkspaceForOperator(docWithTabs(), "device:a");
    expect(filtered.tabs.map((tab) => tab.slug)).toEqual(["shared", "a-private"]);
    expect(filtered.prefs.tabOrder).toEqual(["shared", "a-private"]);
  });

  it("shows an operator only their own private tab plus shared tabs", () => {
    const filtered = filterWorkspaceForOperator(docWithTabs(), "device:b");
    expect(filtered.tabs.map((tab) => tab.slug)).toEqual(["shared", "b-private"]);
  });

  it("fail-closed: an unidentified operator sees no private tabs", () => {
    const filtered = filterWorkspaceForOperator(docWithTabs(), null);
    expect(filtered.tabs.map((tab) => tab.slug)).toEqual(["shared"]);
    expect(filtered.prefs.tabOrder).toEqual(["shared"]);
  });

  it("returns the same reference when nothing is filtered", () => {
    const doc = structuredClone(DEFAULT_DASHBOARD_WORKSPACE) as WorkspaceDoc;
    expect(filterWorkspaceForOperator(doc, null)).toBe(doc);
  });

  it("isTabVisibleToOperator treats shared/unmarked tabs as public", () => {
    const shared = {
      slug: "s",
      title: "S",
      hidden: false,
      createdBy: "user",
      widgets: [],
    } as const;
    expect(isTabVisibleToOperator(shared, null)).toBe(true);
    const priv = { ...shared, visibility: "private", owner: "device:a" } as const;
    expect(isTabVisibleToOperator(priv, "device:a")).toBe(true);
    expect(isTabVisibleToOperator(priv, "device:z")).toBe(false);
  });
});
