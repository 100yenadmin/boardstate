// builtin:sessions — latest-N sessions with a live-run dot. The `mapSessions`
// transform lives in `@boardstate/core`. The source coupled each row to the app
// chat route; the package instead builds the href via `ctx.sessionHref` (defaults
// to "#") and fires `ctx.onNavigate` on activation.

import { html, nothing, type TemplateResult } from "lit";
import { mapSessions, type DashboardWidget } from "@boardstate/core";
import { t } from "../strings.js";
import { formatDateTimeMs } from "./format.js";
import type { BuiltinWidgetContext } from "./types.js";

export function renderSessions(
  widget: DashboardWidget,
  value: unknown,
  ctx?: BuiltinWidgetContext,
): TemplateResult {
  const model = mapSessions(widget, value);
  if (model.rows.length === 0) {
    return html`<div class="dashboard-widget__placeholder">
      ${t("dashboard.widget.sessions.empty")}
    </div>`;
  }
  const href = (key: string): string => ctx?.sessionHref?.(key) ?? "#";
  const onNavigate = ctx?.onNavigate;
  return html`
    <ul class="dashboard-list dashboard-sessions" data-test-id="dashboard-sessions">
      ${model.rows.map(
        (row) => html`
          <li class="dashboard-list__row">
            <a
              class="dashboard-list__link"
              href=${href(row.key)}
              @click=${
                onNavigate
                  ? (event: Event) => {
                      event.preventDefault();
                      onNavigate(row.key);
                    }
                  : nothing
              }
            >
              <span
                class="dashboard-dot ${row.active ? "dashboard-dot--live" : ""}"
                aria-hidden="true"
              ></span>
              <span class="dashboard-list__label">${row.label}</span>
              ${
                row.updatedAt !== null
                  ? html`<span class="dashboard-list__meta"
                      >${formatDateTimeMs(row.updatedAt)}</span
                    >`
                  : nothing
              }
            </a>
          </li>
        `,
      )}
    </ul>
  `;
}
