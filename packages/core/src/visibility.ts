// Response-time private-tab visibility filter (SPEC §11-I6). The store keeps the
// FULL document; a host serving multiple operator identities passes every
// doc-serializing response through this pure filter so a `private` tab never
// leaves the process for an out-of-scope operator. Fail-closed: an unidentified
// caller, or a private tab with no matching owner, sees nothing.

import type { DashboardTab, WorkspaceDoc } from "@boardstate/schema";

/**
 * Whether `tab` may be serialized to the operator identified by `operatorId`. A
 * `shared` (or unmarked) tab is visible to everyone; a `private` tab is visible
 * only to its `owner`. Fail-closed: a private tab with no resolvable owner, or an
 * unidentified operator (`operatorId === null`), is never visible to anyone but a
 * matching owner.
 */
export function isTabVisibleToOperator(tab: DashboardTab, operatorId: string | null): boolean {
  if (tab.visibility !== "private") {
    return true;
  }
  return operatorId !== null && tab.owner === operatorId;
}

/**
 * Return a workspace doc with every `private` tab the operator does not own
 * OMITTED, and `prefs.tabOrder` pruned to match. This is the single read-path
 * filter every response that serializes the doc over the wire must pass through —
 * a private tab must never leave the process for an out-of-scope operator. The
 * stored doc is never mutated; mutations continue to operate on the full doc.
 */
export function filterWorkspaceForOperator(
  doc: WorkspaceDoc,
  operatorId: string | null,
): WorkspaceDoc {
  const visibleTabs = doc.tabs.filter((tab) => isTabVisibleToOperator(tab, operatorId));
  if (visibleTabs.length === doc.tabs.length) {
    return doc;
  }
  const visibleSlugs = new Set(visibleTabs.map((tab) => tab.slug));
  return {
    ...doc,
    tabs: visibleTabs,
    prefs: { ...doc.prefs, tabOrder: doc.prefs.tabOrder.filter((slug) => visibleSlugs.has(slug)) },
  };
}
