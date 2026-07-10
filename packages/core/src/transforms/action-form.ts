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

/**
 * Submission target (SPEC §17 v2). `prompt` (the default) interpolates the template
 * and sends it to the agent; `tool` submits the coerced field values as arguments to a
 * granted external tool (`connector`/`tool`), mapped by `argsFrom`. The template is
 * still authored/validated in `tool` mode but is not sent — the fields ARE the payload.
 */
export type ActionFormMode = "prompt" | "tool";

export type ActionFormModel = {
  template: string;
  fields: ActionFormField[];
  buttonLabel: string | null;
  /** Submission mode; `prompt` when absent (byte-identical to pre-M5 forms). */
  mode: ActionFormMode;
  /** `tool` mode only: the granted connector name; null in `prompt` mode. */
  connector: string | null;
  /** `tool` mode only: the tool to invoke on that connector; null in `prompt` mode. */
  tool: string | null;
  /**
   * `tool` mode only: map of tool-ARGUMENT name → declared FIELD name. Empty when the
   * tool takes no arguments; null in `prompt` mode.
   */
  argsFrom: Record<string, string> | null;
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

/** Read one string→string mapping defensively (tool-mode `argsFrom`); drops non-string values. */
function mapArgsFrom(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [argName, fieldName] of Object.entries(value)) {
    if (typeof fieldName === "string") {
      out[argName] = fieldName;
    }
  }
  return out;
}

/** Read the action-form view model from a widget's props (defensive; schema is the gate). */
export function mapActionForm(widget: DashboardWidget): ActionFormModel {
  const props = widgetProps(widget);
  const template = typeof props.template === "string" ? props.template : "";
  const fields = Array.isArray(props.fields)
    ? props.fields.map(mapField).filter((field): field is ActionFormField => field !== null)
    : [];
  const buttonLabel = typeof props.buttonLabel === "string" ? props.buttonLabel : null;
  const mode: ActionFormMode = props.mode === "tool" ? "tool" : "prompt";
  if (mode !== "tool") {
    return {
      template,
      fields,
      buttonLabel,
      mode: "prompt",
      connector: null,
      tool: null,
      argsFrom: null,
    };
  }
  return {
    template,
    fields,
    buttonLabel,
    mode: "tool",
    connector: typeof props.connector === "string" ? props.connector : null,
    tool: typeof props.tool === "string" ? props.tool : null,
    argsFrom: mapArgsFrom(props.argsFrom),
  };
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

/**
 * Build the tool-mode argument object from a `tool`-mode form's submitted field values.
 * Each `argsFrom` entry maps a tool ARGUMENT name to a declared FIELD name; the field's
 * raw value is typed + length-capped (`coerceFieldValue`) before it lands as an argument.
 * There is NO template interpolation here — the fields ARE the args (the prompt path is
 * unrelated). An entry naming an undeclared field, or a non-`tool` model, is skipped, so
 * an argument can never carry an undeclared value.
 */
export function buildActionToolArgs(
  model: ActionFormModel,
  values: Record<string, string>,
): Record<string, string> {
  const byName = new Map(model.fields.map((field) => [field.name, field]));
  const args: Record<string, string> = {};
  for (const [argName, fieldName] of Object.entries(model.argsFrom ?? {})) {
    const field = byName.get(fieldName);
    if (field) {
      args[argName] = coerceFieldValue(field, values[fieldName] ?? "");
    }
  }
  return args;
}
