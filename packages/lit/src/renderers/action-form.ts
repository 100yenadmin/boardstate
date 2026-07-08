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
  mapActionForm,
  type ActionFormField,
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
  const onSubmit = (event: Event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const values: Record<string, string> = {};
    for (const field of model.fields) {
      const control = form.elements.namedItem(field.name);
      values[field.name] =
        control && "value" in control ? String((control as { value: unknown }).value ?? "") : "";
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
      .catch(() => {
        // Dispatch failures surface via the shared toast; the form stays usable.
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
      ctx.dispatchPrompt
        ? nothing
        : html`<span hidden data-test-id="dashboard-action-form-inert"></span>`
    }
  `;
}
