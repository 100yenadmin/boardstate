// builtin:approvals — the pure pending-approval-queue transform. It reuses the
// reachable approvals infrastructure: the dashboard's own widget-approval registry
// (pending `custom:` widgets). The host presentation package renders the rows and
// resolves each decision through the SAME `dashboard.widget.approve` client path
// the custom-widget pending card uses.
//
// The pending list + resolver arrive via an `ApprovalsWidgetSource` (like the
// embed policy) rather than the primary binding value, because the queue is
// in-memory workspace state rather than an allowlisted RPC read.

import { dashboardAgentProvenance } from "../types.js";
import type { DashboardWidget, DashboardWorkspace } from "../types.js";
import { isRecord, toFiniteNumber, widgetProps } from "./types.js";

const DEFAULT_LIMIT = 8;

/** Operator decision on a pending approval, in the approvals widget's own terms. */
export type ApprovalDecision = "approve" | "reject";

/** Extra options an operator decision may carry (e.g. a partial tool subset). */
export type ApprovalDecisionOptions = {
  /**
   * For `capability` items: the SUBSET of requested `connector:tool` ids the operator
   * ticked (SPEC §17.1 partial grants). Omitted ⇒ approve-all (the whole requested
   * set). Ignored for `widget`/`action` items.
   */
  tools?: string[];
};

/** One pending approval row rendered by the `approvals` builtin. */
export type PendingApprovalItem = {
  /**
   * Stable resolve key: the custom-widget name (`widget`), the connector name
   * (`capability`), or the pending-action id (`action`).
   */
  id: string;
  /**
   * Approval class: an agent-authored widget, a connector's data/tool capability
   * (SPEC §17), or a server-enforced pending action (SPEC §18).
   */
  kind: "widget" | "capability" | "action";
  /** Human label for the pending item. */
  title: string;
  /** Requesting agent id when the item carries agent provenance, else null. */
  requestedBy: string | null;
  /** For `capability`/`action` items: a one-line summary of what it would reach/do. */
  detail?: string;
  /**
   * For `capability` items: the requested `connector:tool` ids the operator may grant
   * as a subset (SPEC §17.1). Empty/omitted ⇒ a data-only grant (no per-tool ticks).
   */
  tools?: string[];
};

/**
 * Pending-approval data + resolver for the `approvals` builtin. The view wires
 * `onDecide` through the same client path the custom-widget pending card uses; a
 * `capability` decision may carry a partial `tools` subset (SPEC §17.1).
 */
export type ApprovalsWidgetSource = {
  pending: PendingApprovalItem[];
  onDecide: (
    item: PendingApprovalItem,
    decision: ApprovalDecision,
    options?: ApprovalDecisionOptions,
  ) => void;
};

/**
 * A live pending-action row for the approvals queue (SPEC §18). Pending actions are
 * IN-MEMORY engine state, not workspace-doc state, so the view supplies them (fetched
 * via `dashboard.action.list`) rather than the transform reading them off the doc.
 */
export type PendingActionInput = {
  id: string;
  connector: string;
  tool: string;
  requestedBy?: string | null;
};

export type ApprovalsModel = {
  items: PendingApprovalItem[];
  total: number;
};

/** Map an approvals widget's UI decision to the registry decision `approveWidget` takes. */
export function toWidgetApprovalDecision(decision: ApprovalDecision): "approved" | "rejected" {
  return decision === "approve" ? "approved" : "rejected";
}

/**
 * Derive the pending-widget-approval source from the workspace registry, wiring
 * each decision through `resolve` (the view passes `approveWidget`). Pure so the
 * view and tests build the identical source.
 */
export function buildWidgetApprovalsSource(
  workspace: DashboardWorkspace,
  resolve: (name: string, decision: "approved" | "rejected") => void,
): ApprovalsWidgetSource {
  const pending: PendingApprovalItem[] = Object.entries(workspace.widgetsRegistry)
    .filter(([, entry]) => entry.status === "pending")
    .map(([name, entry]) => ({
      id: name,
      kind: "widget" as const,
      title: name,
      requestedBy: dashboardAgentProvenance(entry.createdBy),
    }));
  return {
    pending,
    onDecide: (item, decision) => resolve(item.id, toWidgetApprovalDecision(decision)),
  };
}

/** Resolver the approvals widget calls for a pending-action decision (SPEC §18). */
export type ResolveActionDecision = (id: string, decision: "confirm" | "deny") => void;

/**
 * The combined pending-approval source: agent-authored WIDGETS, data/tool CAPABILITY
 * requests (SPEC §17), and server-enforced pending ACTIONS (SPEC §18). Widget
 * decisions route through `resolveWidget` (`approveWidget`); capability decisions
 * through `resolveCapability` (`approveCapability`) — carrying the operator's partial
 * `tools` subset when they ticked one (§17.1); action decisions through the optional
 * `actions.resolve` (`dashboard.action.confirm`/`deny`). Any board with an `approvals`
 * widget then surfaces all three — the single operator queue.
 */
export function buildApprovalsSource(
  workspace: DashboardWorkspace,
  resolveWidget: (name: string, decision: "approved" | "rejected") => void,
  resolveCapability: (name: string, decision: "granted" | "revoked", tools?: string[]) => void,
  actions?: { pending: PendingActionInput[]; resolve: ResolveActionDecision },
): ApprovalsWidgetSource {
  const widgets = buildWidgetApprovalsSource(workspace, resolveWidget).pending;
  const capabilities: PendingApprovalItem[] = Object.entries(workspace.capabilitiesRegistry ?? {})
    .filter(([, grant]) => grant.status === "requested")
    .map(([name, grant]) => {
      const tools = grant.tools ?? [];
      const reach = [
        grant.methods.length
          ? `${grant.methods.length} read${grant.methods.length === 1 ? "" : "s"}`
          : null,
        grant.streams.length
          ? `${grant.streams.length} stream${grant.streams.length === 1 ? "" : "s"}`
          : null,
        tools.length ? `${tools.length} tool${tools.length === 1 ? "" : "s"}` : null,
      ].filter(Boolean);
      return {
        id: name,
        kind: "capability" as const,
        title: name,
        requestedBy: null,
        detail: grant.description ?? (reach.length ? `wants ${reach.join(" + ")}` : "data access"),
        ...(tools.length ? { tools } : {}),
      };
    });
  const pendingActions: PendingApprovalItem[] = (actions?.pending ?? []).map((action) => ({
    id: action.id,
    kind: "action" as const,
    title: `${action.connector}:${action.tool}`,
    requestedBy: action.requestedBy ?? null,
    detail: "awaiting confirm",
  }));
  return {
    // Actions first: a consequential side-effect awaiting confirm is the most urgent
    // row in the operator queue, ahead of grant requests and widget approvals.
    pending: [...pendingActions, ...capabilities, ...widgets],
    onDecide: (item, decision, options) => {
      if (item.kind === "action") {
        actions?.resolve(item.id, decision === "approve" ? "confirm" : "deny");
      } else if (item.kind === "capability") {
        resolveCapability(item.id, decision === "approve" ? "granted" : "revoked", options?.tools);
      } else {
        resolveWidget(item.id, toWidgetApprovalDecision(decision));
      }
    },
  };
}

export function mapApprovals(
  widget: DashboardWidget,
  source: ApprovalsWidgetSource | undefined,
): ApprovalsModel {
  const pending = source?.pending.filter((item) => isRecord(item) && item.id) ?? [];
  const limitProp = toFiniteNumber(widgetProps(widget).limit);
  const limit = limitProp && limitProp > 0 ? Math.trunc(limitProp) : DEFAULT_LIMIT;
  return { items: pending.slice(0, limit), total: pending.length };
}
