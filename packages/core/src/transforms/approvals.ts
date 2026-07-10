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

/** One pending approval row rendered by the `approvals` builtin. */
export type PendingApprovalItem = {
  /** Stable resolve key: the custom-widget name (`widget`) or connector name (`capability`). */
  id: string;
  /** Approval class: an agent-authored widget, or a connector's data capability (SPEC §17). */
  kind: "widget" | "capability";
  /** Human label for the pending item. */
  title: string;
  /** Requesting agent id when the item carries agent provenance, else null. */
  requestedBy: string | null;
  /** For `capability` items: a one-line summary of what it would reach. */
  detail?: string;
};

/**
 * Pending-approval data + resolver for the `approvals` builtin. The view wires
 * `onDecide` through the same client path the custom-widget pending card uses.
 */
export type ApprovalsWidgetSource = {
  pending: PendingApprovalItem[];
  onDecide: (item: PendingApprovalItem, decision: ApprovalDecision) => void;
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

/**
 * The combined pending-approval source: agent-authored WIDGETS plus data-source
 * CAPABILITY requests (SPEC §17). Widget decisions route through `resolveWidget`
 * (`approveWidget`) and capability decisions through `resolveCapability`
 * (`approveCapability`); an `approve` grants and a `reject` revokes. Any board with
 * an `approvals` widget then surfaces both — the single operator queue.
 */
export function buildApprovalsSource(
  workspace: DashboardWorkspace,
  resolveWidget: (name: string, decision: "approved" | "rejected") => void,
  resolveCapability: (name: string, decision: "granted" | "revoked") => void,
): ApprovalsWidgetSource {
  const widgets = buildWidgetApprovalsSource(workspace, resolveWidget).pending;
  const capabilities: PendingApprovalItem[] = Object.entries(workspace.capabilitiesRegistry ?? {})
    .filter(([, grant]) => grant.status === "requested")
    .map(([name, grant]) => {
      const toolCount = grant.tools?.length ?? 0;
      const reach = [
        grant.methods.length
          ? `${grant.methods.length} read${grant.methods.length === 1 ? "" : "s"}`
          : null,
        grant.streams.length
          ? `${grant.streams.length} stream${grant.streams.length === 1 ? "" : "s"}`
          : null,
        toolCount ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : null,
      ].filter(Boolean);
      return {
        id: name,
        kind: "capability" as const,
        title: name,
        requestedBy: null,
        detail: grant.description ?? (reach.length ? `wants ${reach.join(" + ")}` : "data access"),
      };
    });
  return {
    pending: [...capabilities, ...widgets],
    onDecide: (item, decision) => {
      if (item.kind === "capability") {
        resolveCapability(item.id, decision === "approve" ? "granted" : "revoked");
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
