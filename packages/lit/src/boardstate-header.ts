// `<boardstate-header>` — a light-DOM breadcrumb header with a trailing actions
// slot. The source hardcoded an app brand crumb + router title lookup; the package
// takes an injectable `brandLabel` (default empty), an explicit `currentLabel`, and
// an optional `agentLabel`, and emits a `navigate` CustomEvent (detail "overview")
// when the brand crumb is a link and is activated.

import { LitElement, html, nothing } from "lit";

/** Event emitted when the overview breadcrumb link is activated. */
export type BoardstateHeaderNavigateEvent = CustomEvent<"overview">;

export class BoardstateHeaderElement extends LitElement {
  /** Render into light DOM so app CSS/theme tokens apply. */
  override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Trailing crumb label (the current view name). */
  currentLabel = "";
  /** Optional context crumb (e.g. an agent/workspace label). */
  agentLabel = "";
  /** Leading brand crumb; empty renders no brand crumb. */
  brandLabel = "";
  /** When set, the brand crumb is a link to this href and emits `navigate`. */
  overviewHref = "";

  static override properties = {
    currentLabel: { type: String },
    agentLabel: { type: String },
    brandLabel: { type: String },
    overviewHref: { type: String },
  };

  private readonly handleOverviewClick = (event: MouseEvent): void => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    this.dispatchEvent(
      new CustomEvent("navigate", { detail: "overview", bubbles: true, composed: true }),
    );
  };

  override render(): unknown {
    const label = this.currentLabel.trim();
    const agentLabel = this.agentLabel.trim();
    const brand = this.brandLabel.trim();
    return html`
      <div class="dashboard-header">
        <div class="dashboard-header__breadcrumb">
          ${
            brand
              ? this.overviewHref
                ? html`<a
                    class="dashboard-header__breadcrumb-link"
                    href=${this.overviewHref}
                    @click=${this.handleOverviewClick}
                    >${brand}</a
                  >`
                : html`<span class="dashboard-header__breadcrumb-link">${brand}</span>`
              : nothing
          }
          ${
            agentLabel
              ? html`
                  <span class="dashboard-header__breadcrumb-segment">
                    ${
                      brand
                        ? html`<span class="dashboard-header__breadcrumb-sep">›</span>`
                        : nothing
                    }
                    <span class="dashboard-header__breadcrumb-context" title=${agentLabel}>
                      ${agentLabel}
                    </span>
                  </span>
                `
              : nothing
          }
          ${
            label
              ? html`
                  ${
                    brand || agentLabel
                      ? html`<span class="dashboard-header__breadcrumb-sep">›</span>`
                      : nothing
                  }
                  <span class="dashboard-header__breadcrumb-current">${label}</span>
                `
              : nothing
          }
        </div>
        <div class="dashboard-header__actions">
          <slot></slot>
        </div>
      </div>
    `;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("boardstate-header")) {
  customElements.define("boardstate-header", BoardstateHeaderElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "boardstate-header": BoardstateHeaderElement;
  }
}
