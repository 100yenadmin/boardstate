// builtin:action-form — a small operator-authored form that dispatches a prompt.
// The `template` and `fields` are authored at write time and schema-validated; only
// the field VALUES vary per click.
//
// SECURITY MODEL (normative): interpolation (`buildActionFormPrompt`, in
// `@boardstate/core`) is a SINGLE pass over the authored template — each `{slot}`
// is replaced by the typed, length-capped value of the declared field of that name.
// Because the TEMPLATE (not the values) is scanned with a function replacer, an
// injected `{evil}` inside a field VALUE is inserted literally and NEVER re-scanned.
// Submission goes through `ctx.dispatchPrompt`, the SAME confirm + rate-limit gate
// the custom-widget bridge uses — the builtin gains no new dispatch privilege.

import { html, nothing, type TemplateResult } from "lit";
import {
  ACTION_FORM_DEFAULT_MAX_LENGTH,
  buildActionFormPrompt,
  buildActionToolArgs,
  mapActionForm,
  type ActionFormField,
  type ActionFormModel,
  type DashboardWidget,
} from "@boardstate/core";
import { t } from "../strings.js";
import type { BuiltinWidgetContext } from "./types.js";

function renderField(field: ActionFormField): TemplateResult {
  const control =
    field.type === "select"
      ? html`<select class="dashboard-action-form__control" name=${field.name}>
          ${(field.options ?? []).map((option) => html`<option value=${option}>${option}</option>`)}
        </select>`
      : html`<input
          class="dashboard-action-form__control"
          type=${field.type === "number" ? "number" : "text"}
          name=${field.name}
          maxlength=${field.maxLength ?? ACTION_FORM_DEFAULT_MAX_LENGTH}
        />`;
  return html`<label class="dashboard-action-form__field">
    <span class="dashboard-action-form__label">${field.label}</span>
    ${control}
  </label>`;
}

/**
 * Submit a `tool`-mode form: the coerced field values become the tool ARGS (via
 * `argsFrom`) and go through the SAME `dashboard.action.invoke` seam the action-button
 * uses — no template interpolation, no new dispatch privilege. A readOnly tool executes
 * (the form resets); a mutation PARKS as an operator-confirmed pending action, surfaced
 * on the shared toast; a rejection (ungranted/revoked/rate-limited) surfaces there too.
 */
function submitTool(
  model: ActionFormModel,
  widget: DashboardWidget,
  values: Record<string, string>,
  ctx: BuiltinWidgetContext,
  form: HTMLFormElement,
): void {
  if (!ctx.actions || !model.connector || !model.tool) {
    return;
  }
  const args = buildActionToolArgs(model, values);
  void ctx.actions
    .invoke({ connector: model.connector, tool: model.tool, args })
    .then((outcome) => {
      if (outcome.kind === "pending") {
        ctx.onActionError?.(t("dashboard.widget.actionForm.toolPending"));
      }
      // A readOnly tool executed (or a mutation parked cleanly): reset for re-use.
      form.reset();
      void widget;
    })
    .catch((err: unknown) => {
      ctx.onActionError?.(err instanceof Error ? err.message : String(err));
    });
}

/** Renders the action-form builtin. Submit interpolates + dispatches through the shared gate. */
export function renderActionForm(
  widget: DashboardWidget,
  _value: unknown,
  ctx: BuiltinWidgetContext,
): TemplateResult {
  const model = mapActionForm(widget);
  if (model.fields.length === 0 || !model.template) {
    return html`<div class="dashboard-widget__placeholder">
      ${t("dashboard.widget.actionForm.empty")}
    </div>`;
  }
  const readValues = (form: HTMLFormElement): Record<string, string> => {
    const values: Record<string, string> = {};
    for (const field of model.fields) {
      const control = form.elements.namedItem(field.name);
      values[field.name] =
        control && "value" in control ? String((control as { value: unknown }).value ?? "") : "";
    }
    return values;
  };
  const onSubmit = (event: Event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const values = readValues(form);
    if (model.mode === "tool") {
      submitTool(model, widget, values, ctx, form);
      return;
    }
    const text = buildActionFormPrompt(model, values);
    if (!text.trim() || !ctx.dispatchPrompt) {
      return;
    }
    // widgetKey namespaces the shared rate budget by this widget's stable id.
    void ctx
      .dispatchPrompt({ widgetKey: `builtin:action-form:${widget.id}`, text })
      .then((outcome) => {
        if (outcome === "sent") {
          form.reset();
        }
      })
      .catch((err: unknown) => {
        // Surface the failure on the view's shared toast; the form stays usable.
        ctx.onActionError?.(err instanceof Error ? err.message : String(err));
      });
  };
  return html`
    <form class="dashboard-action-form" data-test-id="dashboard-action-form" @submit=${onSubmit}>
      ${model.fields.map(renderField)}
      <button
        class="bs-btn bs-btn--small bs-btn--primary dashboard-action-form__submit"
        type="submit"
      >
        ${model.buttonLabel ?? t("dashboard.widget.actionForm.submit")}
      </button>
    </form>
    ${
      // The form is inert when its submission seam is absent: `dispatchPrompt` for a
      // prompt form, the action seam for a tool form (no live transport).
      (model.mode === "tool" ? ctx.actions : ctx.dispatchPrompt)
        ? nothing
        : html`<span hidden data-test-id="dashboard-action-form-inert"></span>`
    }
  `;
}
