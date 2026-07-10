// builtin:action-button — the pure view model behind a one-click invocation of a
// granted external tool (SPEC §17 v2 / §18). The button carries a FIXED `args` object
// authored at write time and schema-validated; a click submits `{connector, tool, args}`
// through the host presentation package's `dashboard.action.invoke` seam.
//
// SECURITY MODEL (normative): this transform only shapes the authored props into a
// view model. The invocation itself is AND-gated twice by the engine (the tool must be
// granted at workspace-validation time AND re-checked at invoke time), a readOnly tool
// executes directly while a mutation is PARKED as an operator-confirmed pending action
// (epic invariant #5), and any tool RESULT is rendered inert by the renderer (invariant
// #1). Nothing here reaches a network or a credential.

import type { JsonValue } from "@boardstate/schema";
import type { DashboardWidget } from "../types.js";
import { isRecord, widgetProps } from "./types.js";

export type ActionButtonModel = {
  connector: string;
  tool: string;
  /** Fixed argument object sent on click, or null when the tool takes no args. */
  args: Record<string, JsonValue> | null;
  /** Button text, or null to fall back to the renderer's default label. */
  label: string | null;
};

/**
 * Read the action-button view model from a widget's props (defensive; the schema
 * `validateActionButtonProps` gate is the real bound). A malformed connector/tool
 * yields empty strings so the renderer degrades to an inert placeholder rather than
 * invoking against a bad ref.
 */
export function mapActionButton(widget: DashboardWidget): ActionButtonModel {
  const props = widgetProps(widget);
  const connector = typeof props.connector === "string" ? props.connector : "";
  const tool = typeof props.tool === "string" ? props.tool : "";
  const args = isRecord(props.args) ? (props.args as Record<string, JsonValue>) : null;
  const label = typeof props.label === "string" ? props.label : null;
  return { connector, tool, args, label };
}
