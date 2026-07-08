// Pending custom-widget approvals — a tiny, framework-free coordinator the UI drives.
//
// Only `approved` custom widgets ever mount an iframe (SPEC §8.2). When the host
// surfaces a pending widget, the UI registers it here via `onApprovalRequired`; the
// operator's approve/reject then resolves it, invoking the registered decide
// callback (which typically calls `approveWidget` on the store). The store's
// `approveWidget` remains the single write path; this only tracks the UI-side queue.

/** A custom widget awaiting operator approval, keyed by its registry name. */
export type ApprovalRequest = {
  /** The `custom:<name>` widget name (registry key). */
  name: string;
  /** Provenance stamp of whoever installed the widget, if known. */
  createdBy?: string;
};

export type ApprovalDecision = "approved" | "rejected";

/** Invoked when the operator decides a pending approval; wire this to the store. */
export type ApprovalCallback = (
  request: ApprovalRequest,
  decision: ApprovalDecision,
) => void | Promise<void>;

export type PendingApprovals = {
  /**
   * Register a pending approval and the callback that applies the operator's
   * decision. Idempotent by `request.name` — a re-register replaces the decide
   * callback (e.g. a re-render) without duplicating the queue entry.
   */
  onApprovalRequired: (request: ApprovalRequest, decide: ApprovalCallback) => void;
  /** The pending requests, in registration order. */
  list: () => ApprovalRequest[];
  /** Whether a request is still pending. */
  has: (name: string) => boolean;
  /**
   * Resolve a pending request with the operator's decision: run its decide callback
   * and drop it from the queue. A no-op (resolves undefined) for an unknown name.
   */
  resolve: (name: string, decision: ApprovalDecision) => Promise<void>;
  /** Drop a pending request without deciding it (e.g. it vanished from the doc). */
  cancel: (name: string) => void;
  /** Drop every pending request (teardown). */
  clear: () => void;
};

/** Create an in-memory pending-approvals queue the UI can drive. */
export function createPendingApprovals(): PendingApprovals {
  const entries = new Map<string, { request: ApprovalRequest; decide: ApprovalCallback }>();
  return {
    onApprovalRequired(request, decide) {
      entries.set(request.name, { request, decide });
    },
    list() {
      return [...entries.values()].map((entry) => entry.request);
    },
    has(name) {
      return entries.has(name);
    },
    async resolve(name, decision) {
      const entry = entries.get(name);
      if (!entry) {
        return;
      }
      entries.delete(name);
      await entry.decide(entry.request, decision);
    },
    cancel(name) {
      entries.delete(name);
    },
    clear() {
      entries.clear();
    },
  };
}
