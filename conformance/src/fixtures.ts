// Canonical minimal workspace documents for the conformance suite. Every fixture
// is a builder returning a FRESH object so a test can mutate its copy freely and
// so the same fixture drives repeated `dashboard.workspace.replace` calls without
// cross-test aliasing. Each doc validates under `@boardstate/schema`
// `validateWorkspaceDoc`; `workspaceVersion` is irrelevant on the wire (the store
// stamps `current + 1` on every committed mutation) and is fixed at 0 here.

import type { WorkspaceDoc } from "@boardstate/schema";

/** One shared tab ("ops") with one builtin stat-card widget ("revenue-card"). */
export function oneTabDoc(): WorkspaceDoc {
  return {
    schemaVersion: 1,
    workspaceVersion: 0,
    tabs: [
      {
        slug: "ops",
        title: "Ops",
        hidden: false,
        createdBy: "user",
        widgets: [
          {
            id: "revenue-card",
            kind: "builtin:stat-card",
            title: "Revenue",
            grid: { x: 0, y: 0, w: 4, h: 2 },
            collapsed: false,
            hidden: false,
          },
        ],
      },
    ],
    widgetsRegistry: {},
    prefs: { tabOrder: ["ops"] },
  };
}

/**
 * A doc whose registry CLAIMS `approved` (with provenance) for a custom widget
 * that is not currently approved — the untrusted-import shape SPEC §8.2 / §11-I3
 * forces back to `pending` with `approvedBy`/`approvedAt` stripped when submitted
 * through `dashboard.workspace.replace`.
 */
export function customWidgetClaimingApprovedDoc(name = "my-widget"): WorkspaceDoc {
  const doc = oneTabDoc();
  doc.widgetsRegistry = {
    [name]: {
      status: "approved",
      createdBy: "user",
      approvedBy: "user",
      approvedAt: "2026-01-01T00:00:00.000Z",
    },
  };
  return doc;
}

/** A single `private` tab owned by `owner` (owner is REQUIRED when private). */
export function privateTabDoc(owner: string): WorkspaceDoc {
  return {
    schemaVersion: 1,
    workspaceVersion: 0,
    tabs: [
      {
        slug: "secret",
        title: "Secret",
        hidden: false,
        createdBy: "user",
        visibility: "private",
        owner,
        widgets: [],
      },
    ],
    widgetsRegistry: {},
    prefs: { tabOrder: ["secret"] },
  };
}
