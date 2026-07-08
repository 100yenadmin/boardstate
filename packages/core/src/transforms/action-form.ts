// builtin:action-form — the pure interpolation + field-coercion transform behind
// an operator-authored prompt form. The host presentation package renders the form
// and routes submission through its shared confirm+rate-limit gate.
//
// SECURITY MODEL (normative): interpolation is a SINGLE pass over the authored
// `template` (`buildActionFormPrompt`) — each `{slot}` is replaced by the typed,
// length-capped value of the declared field of that name. Because we scan the
// TEMPLATE (not the values) with a function replacer, an injected `{evil}` inside a
// field VALUE is inserted literally and NEVER re-scanned — no nested/double
// expansion. Undeclared slots are left verbatim.

import type { DashboardWidget } from "../types.js";
import { isRecord, widgetProps } from "./types.js";

export type ActionFormFieldType = "text" | "number" | "select";

export type ActionFormField = {
  name: string;
  label: string;
  type: ActionFormFieldType;
  options?: string[];
  maxLength?: number;
};

export type ActionFormModel = {
  template: string;
  fields: ActionFormField[];
  buttonLabel: string | null;
};

/** Default per-field value cap when a field declares no `maxLength`. */
export const ACTION_FORM_DEFAULT_MAX_LENGTH = 200;

// Same alphabet as the write-time slot check (schema) — keep in sync.
const SLOT_PATTERN = /\{([A-Za-z0-9_]+)\}/g;
const FIELD_TYPES = new Set<ActionFormFieldType>(["text", "number", "select"]);

/** Defensively parse one field descriptor from untyped props, or null when malformed. */
function mapField(value: unknown): ActionFormField | null {
  if (!isRecord(value)) {
    return null;
  }
  const { name, label, type } = value;
  if (typeof name !== "string" || !name || typeof label !== "string" || !label) {
    return null;
  }
  if (typeof type !== "string" || !FIELD_TYPES.has(type as ActionFormFieldType)) {
    return null;
  }
  const options =
    type === "select" && Array.isArray(value.options)
      ? value.options.filter((option): option is string => typeof option === "string")
      : undefined;
  if (type === "select" && (!options || options.length === 0)) {
    return null;
  }
  const maxLength =
    typeof value.maxLength === "number" && Number.isInteger(value.maxLength) && value.maxLength > 0
      ? value.maxLength
      : undefined;
  return {
    name,
    label,
    type: type as ActionFormFieldType,
    ...(options ? { options } : {}),
    ...(maxLength !== undefined ? { maxLength } : {}),
  };
}

/** Read the action-form view model from a widget's props (defensive; schema is the gate). */
export function mapActionForm(widget: DashboardWidget): ActionFormModel {
  const props = widgetProps(widget);
  const template = typeof props.template === "string" ? props.template : "";
  const fields = Array.isArray(props.fields)
    ? props.fields.map(mapField).filter((field): field is ActionFormField => field !== null)
    : [];
  const buttonLabel = typeof props.buttonLabel === "string" ? props.buttonLabel : null;
  return { template, fields, buttonLabel };
}

/** Type + length cap for one field's raw string value. Non-numeric numbers and out-of-set selects collapse to "". */
export function coerceFieldValue(field: ActionFormField, raw: string): string {
  const cap =
    field.maxLength && field.maxLength > 0 ? field.maxLength : ACTION_FORM_DEFAULT_MAX_LENGTH;
  if (field.type === "number") {
    const trimmed = raw.trim();
    return trimmed && Number.isFinite(Number(trimmed)) ? trimmed.slice(0, cap) : "";
  }
  if (field.type === "select") {
    return field.options?.includes(raw) ? raw : "";
  }
  return raw.slice(0, cap);
}

/**
 * Interpolate declared field values into the authored template in a SINGLE pass.
 * Only `{slot}` tokens that name a declared field are replaced; the replacement
 * text is inserted literally (function replacer) and never re-scanned, so a value
 * containing `{...}` cannot expand. Unknown slots are left verbatim.
 */
export function buildActionFormPrompt(
  model: ActionFormModel,
  values: Record<string, string>,
): string {
  const byName = new Map(model.fields.map((field) => [field.name, field]));
  return model.template.replace(SLOT_PATTERN, (match, name: string) => {
    const field = byName.get(name);
    if (!field) {
      return match;
    }
    return coerceFieldValue(field, values[name] ?? "");
  });
}
