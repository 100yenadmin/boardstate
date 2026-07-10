// builtin:approvals — a pending-approval queue with per-row Approve/Deny actions, plus
// live-grant management (SPEC §17.1 partial grants, §17.2 per-tool auto-confirm #62, and
// §17 grant TTLs #64).
//
// The pending list + resolver arrive via `ctx.approvals` (mirroring iframe-embed's
// `ctx.embed`), not the primary binding `value`, because the queue is in-memory
// workspace state rather than an allowlisted RPC read. The view wires `onDecide`
// through the same client path the custom-widget pending card uses. The
// `mapApprovals` / `buildApprovalsSource` transforms live in `@boardstate/core`.

import { html, nothing, type TemplateResult } from "lit";
import {
  mapApprovals,
  type ApprovalDecisionOptions,
  type DashboardWidget,
  type PendingApprovalItem,
} from "@boardstate/core";
import { t } from "../strings.js";
import type { BuiltinWidgetContext } from "./types.js";

/** The badge label for an approval row's kind (widget / data source / action). */
function kindLabel(kind: "widget" | "capability" | "action"): string {
  if (kind === "capability") {
    return t("dashboard.widget.approvals.kind.capability");
  }
  if (kind === "action") {
    return t("dashboard.widget.approvals.kind.action");
  }
  return t("dashboard.widget.approvals.kind.widget");
}

/** Collect the values of the ticked checkboxes matching `selector` inside THIS row. */
function checkedValues(event: Event, selector: string): string[] {
  const row = (event.currentTarget as HTMLElement | null)?.closest("li");
  if (!row) {
    return [];
  }
  return [...row.querySelectorAll<HTMLInputElement>(selector)]
    .filter((box) => box.checked)
    .map((box) => box.value);
}

/** Read the row's optional TTL input (minutes) and turn it into a future ISO instant. */
function readTtl(event: Event): string | undefined {
  const row = (event.currentTarget as HTMLElement | null)?.closest("li");
  const input = row?.querySelector<HTMLInputElement>("input.dashboard-approvals__ttl");
  const minutes = input && input.value.trim() !== "" ? Number(input.value) : NaN;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return undefined;
  }
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/**
 * Build the operator's decision options from a capability row's controls (#62/#64). For a
 * row WITH tool ticks, `tools` is always present (even empty — unticking all grants
 * nothing, never approve-all); a data-only row carries just the optional TTL.
 */
function collectCapabilityOptions(event: Event, hasTools: boolean): ApprovalDecisionOptions {
  const expiresAt = readTtl(event);
  if (!hasTools) {
    return expiresAt !== undefined ? { expiresAt } : {};
  }
  const tools = checkedValues(event, "input.dashboard-approvals__grant");
  const autoConfirm = checkedValues(event, "input.dashboard-approvals__auto");
  return {
    tools,
    // Auto-confirm can only cover tools that are also being granted (the engine + schema
    // reject an outsider); intersect defensively so a stale tick never leaks through.
    ...(autoConfirm.length ? { autoConfirm: autoConfirm.filter((id) => tools.includes(id)) } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
}

/** A coarse "expires in 2h 5m" label from an ISO instant (refreshed on each re-render). */
function expiresLabel(expiresAt: string): string {
  const remaining = Date.parse(expiresAt) - Date.now();
  if (Number.isNaN(remaining) || remaining <= 0) {
    return t("dashboard.widget.approvals.expiresSoon");
  }
  const minutes = Math.round(remaining / 60_000);
  const hours = Math.floor(minutes / 60);
  const human = hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
  return t("dashboard.widget.approvals.expiresIn", { duration: human });
}

/**
 * The per-agent scope line for a capability row (SPEC §17.3, #59). A scoped grant shows
 * exactly which agents may use its tools; an unscoped grant reads "All agents" so the
 * operator sees the (permissive) default plainly rather than an ambiguous blank.
 */
function renderScope(item: PendingApprovalItem): TemplateResult {
  const agents = item.agents ?? [];
  const summary =
    agents.length > 0
      ? t("dashboard.widget.approvals.scopedTo", { agents: agents.join(", ") })
      : t("dashboard.widget.approvals.scopeAll");
  return html`<span
    class="dashboard-approvals__scope"
    data-test-id="dashboard-approvals-scope"
    data-agents=${agents.join(",")}
    >${t("dashboard.widget.approvals.scopeLabel")}: ${summary}</span
  >`;
}

/** The per-tool grant + auto-confirm control list for a capability row. */
function renderToolControls(item: PendingApprovalItem): TemplateResult {
  const tools = item.tools ?? [];
  const auto = new Set(item.autoConfirm ?? []);
  // A granted row's tools are already granted (pre-ticked); a requested row's are
  // proposed (also pre-ticked so approve-all is one click).
  return html`<ul class="dashboard-approvals__tools" data-test-id="dashboard-approvals-tools">
    ${tools.map(
      (tool) =>
        html`<li>
          <label class="dashboard-approvals__grant-label"
            ><input type="checkbox" class="dashboard-approvals__grant" value=${tool} checked /><span
              >${tool}</span
            ></label
          >
          <label
            class="dashboard-approvals__auto-label"
            title=${t("dashboard.widget.approvals.autoConfirmHint")}
            ><input
              type="checkbox"
              class="dashboard-approvals__auto"
              value=${tool}
              ?checked=${auto.has(tool)}
            /><span>${t("dashboard.widget.approvals.autoConfirm")}</span></label
          >
        </li>`,
    )}
  </ul>`;
}

export function renderApprovals(
  widget: DashboardWidget,
  _value: unknown,
  ctx: BuiltinWidgetContext,
): TemplateResult {
  const source = ctx.approvals;
  const model = mapApprovals(widget, source);
  if (model.items.length === 0) {
    return html`<div class="dashboard-widget__placeholder">
      ${t("dashboard.widget.approvals.empty")}
    </div>`;
  }
  return html`
    <ul class="dashboard-list dashboard-approvals" data-test-id="dashboard-approvals">
      ${model.items.map((item) => {
        const isCapability = item.kind === "capability";
        const hasTools = isCapability && (item.tools ?? []).length > 0;
        // A pending action (SPEC §18) confirms; a requested grant approves; a granted grant
        // saves its updated auto-confirm/TTL (a renew is just a re-approve).
        const affirmLabel = item.granted
          ? t("dashboard.widget.approvals.save")
          : item.kind === "action"
            ? t("dashboard.widget.approvals.confirm")
            : t("dashboard.widget.approvals.approve");
        const affirm = (event: Event) => {
          // A widget/action row approves/confirms with no options (byte-identical to the
          // pre-#62 path); a capability row carries the operator's tool/auto-confirm/TTL
          // choices — but only when non-empty, so a plain data-grant approve stays a bare
          // `onDecide(item, "approve")`.
          if (!isCapability) {
            source?.onDecide(item, "approve");
            return;
          }
          const options = collectCapabilityOptions(event, hasTools);
          if (Object.keys(options).length > 0) {
            source?.onDecide(item, "approve", options);
          } else {
            source?.onDecide(item, "approve");
          }
        };
        const denyLabel = item.granted
          ? t("dashboard.widget.approvals.revoke")
          : t("dashboard.widget.approvals.deny");
        return html`
          <li
            class="dashboard-list__row ${item.granted ? "dashboard-approvals__row--granted" : ""}"
          >
            <span class="dashboard-badge dashboard-badge--muted">${kindLabel(item.kind)}</span>
            <span class="dashboard-list__label">${item.title}</span>
            ${
              item.detail
                ? html`<span class="dashboard-list__meta">${item.detail}</span>`
                : item.requestedBy
                  ? html`<span class="dashboard-list__meta"
                      >${t("dashboard.widget.approvals.requestedBy", { agent: item.requestedBy })}</span
                    >`
                  : nothing
            }
            ${
              item.expiresAt
                ? html`<span
                    class="dashboard-approvals__countdown"
                    data-test-id="dashboard-approvals-countdown"
                    >${expiresLabel(item.expiresAt)}</span
                  >`
                : nothing
            }
            ${hasTools ? renderToolControls(item) : nothing}
            ${isCapability ? renderScope(item) : nothing}
            ${
              isCapability
                ? html`<label class="dashboard-approvals__ttl-label"
                    >${t("dashboard.widget.approvals.ttlLabel")}
                    <input
                      type="number"
                      min="1"
                      class="dashboard-approvals__ttl"
                      data-test-id="dashboard-approvals-ttl"
                  /></label>`
                : nothing
            }
            <span class="dashboard-approvals__actions">
              <button
                class="bs-btn bs-btn--small bs-btn--primary"
                type="button"
                data-test-id="dashboard-approvals-approve"
                @click=${affirm}
              >
                ${affirmLabel}
              </button>
              <button
                class="bs-btn bs-btn--small"
                type="button"
                data-test-id="dashboard-approvals-deny"
                @click=${() => source?.onDecide(item, "reject")}
              >
                ${denyLabel}
              </button>
            </span>
          </li>
        `;
      })}
    </ul>
  `;
}
