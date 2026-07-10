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
  /**
   * For `capability` items: the SUBSET of granted tools the operator marked "always
   * allow" (SPEC §17.2 per-tool auto-confirm, #62). Each id ⊆ the granted `tools`. Absent
   * ⇒ no auto-confirm (and CLEARS any prior — the approve verb is the sole writer).
   */
  autoConfirm?: string[];
  /**
   * For `capability` items: an ISO-8601 TTL the operator set on the grant (SPEC §17 grant
   * TTLs, #64) — the grant re-pends to `requested` after this instant. Absent ⇒ permanent.
   */
  expiresAt?: string;
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
  /**
   * For a GRANTED `capability` management row (#62/#64): the grant is live, not pending —
   * the row offers per-tool auto-confirm toggles, renew, and revoke rather than approve.
   */
  granted?: boolean;
  /**
   * For `capability` items: the tools currently marked "always allow" (SPEC §17.2, #62),
   * so the widget can pre-tick the auto-confirm toggles.
   */
  autoConfirm?: string[];
  /**
   * For a time-boxed `capability` grant (SPEC §17 grant TTLs, #64): the ISO-8601 instant
   * it expires, so the widget can render a live countdown.
   */
  expiresAt?: string;
  /**
   * For a per-agent-scoped `capability` grant (SPEC §17.3, #59): the agent actors the
   * grant is scoped to. Absent ⇒ all agents (the grant is unscoped); present ⇒ the widget
   * renders the scope so the operator sees WHICH agents may use the granted tools.
   */
  agents?: string[];
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
  resolveCapability: (
    name: string,
    decision: "granted" | "revoked",
    options?: ApprovalDecisionOptions,
  ) => void,
  actions?: { pending: PendingActionInput[]; resolve: ResolveActionDecision },
): ApprovalsWidgetSource {
  const widgets = buildWidgetApprovalsSource(workspace, resolveWidget).pending;
  const grants = Object.entries(workspace.capabilitiesRegistry ?? {});
  const reachOf = (grant: DashboardWorkspace["capabilitiesRegistry"][string]): string => {
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
    return grant.description ?? (reach.length ? `wants ${reach.join(" + ")}` : "data access");
  };
  // Requested grants await an approve decision (SPEC §17.1); the operator may grant a
  // subset, mark tools auto-confirm (#62), and set a TTL (#64) — the renderer collects
  // those into the decision options.
  const requested: PendingApprovalItem[] = grants
    .filter(([, grant]) => grant.status === "requested")
    .map(([name, grant]) => ({
      id: name,
      kind: "capability" as const,
      title: name,
      requestedBy: null,
      detail: reachOf(grant),
      ...((grant.tools ?? []).length ? { tools: grant.tools } : {}),
    }));
  // GRANTED tool-grants surface as MANAGEMENT rows (SPEC §17.2/§17 TTLs): per-tool
  // auto-confirm toggles, a renew (re-approve) affordance for time-boxed grants, and a
  // one-click revoke. A pure data grant (no tools, no TTL) needs no management surface.
  const granted: PendingApprovalItem[] = grants
    .filter(
      ([, grant]) =>
        grant.status === "granted" && ((grant.tools ?? []).length > 0 || grant.expiresAt),
    )
    .map(([name, grant]) => ({
      id: name,
      kind: "capability" as const,
      title: name,
      requestedBy: null,
      granted: true,
      detail: reachOf(grant),
      ...((grant.tools ?? []).length ? { tools: grant.tools } : {}),
      ...((grant.autoConfirm ?? []).length ? { autoConfirm: grant.autoConfirm } : {}),
      ...(grant.expiresAt ? { expiresAt: grant.expiresAt } : {}),
      ...((grant.agents ?? []).length ? { agents: grant.agents } : {}),
    }));
  const pendingActions: PendingApprovalItem[] = (actions?.pending ?? []).map((action) => ({
    id: action.id,
    kind: "action" as const,
    title: `${action.connector}:${action.tool}`,
    requestedBy: action.requestedBy ?? null,
    detail: "awaiting confirm",
  }));
  return {
    // Actions first (a consequential side-effect awaiting confirm is the most urgent),
    // then requested grants + widget approvals, then live-grant management rows last.
    pending: [...pendingActions, ...requested, ...widgets, ...granted],
    onDecide: (item, decision, options) => {
      if (item.kind === "action") {
        actions?.resolve(item.id, decision === "approve" ? "confirm" : "deny");
      } else if (item.kind === "capability") {
        resolveCapability(item.id, decision === "approve" ? "granted" : "revoked", options);
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
