// Contract for the builtin widget renderers. Each builtin is a pure render
// function keyed by its kind (`builtin:<name>`); the widget cell dispatches through
// the registry (`./index.ts`). The data-shape `map*` transforms live in
// `@boardstate/core` (imported by each renderer) — renderers only turn an
// already-resolved value into DOM, and throw only on real bugs.

import type { TemplateResult } from "lit";
import type { ApprovalsWidgetSource, DashboardWidget } from "@boardstate/core";
import type { PromptDispatchOutcome } from "@boardstate/host";

/**
 * Widget-id-bound accessor for the write-back state store. The host binds both
 * methods to THAT widget's id before handing this to the renderer, so a renderer
 * never names a widget id itself — it can only read/write its own state. Present
 * only for stateful builtins (notes); absent renderers degrade to read-only.
 */
export type BuiltinWidgetState = {
  get(): Promise<{ state: unknown; version?: number }>;
  set(blob: unknown): Promise<{ version: number }>;
};

/** Ambient context a builtin may need beyond its own binding value. */
export type BuiltinWidgetContext = {
  /** Embed policy — only the iframe-embed and preview widgets consume it. */
  embed: {
    embedSandboxMode: "strict" | "scripts";
    allowExternalEmbedUrls: boolean;
  };
  /**
   * Build an href for a session key (the sessions widget links each row). The
   * source coupled this to the app router; the package injects it instead.
   * Defaults to "#".
   */
  sessionHref?: (key: string) => string;
  /** Invoked when a session row is activated, for embedders that route in JS. */
  onNavigate?: (key: string) => void;
  /**
   * Persistence accessor bound to the current widget's id. Only stateful builtins
   * (notes) consume it; absent when the host has no live transport.
   */
  state?: BuiltinWidgetState;
  /**
   * Confirm + rate-limited prompt dispatch — only the action-form widget consumes
   * it. Wired (in the view) to the SAME shared gate the custom-widget bridge uses
   * (`dispatchRateLimitedPrompt`), so builtins gain no new dispatch privilege.
   * Absent in isolated unit renders; the form then treats submit as inert.
   */
  dispatchPrompt?: (params: { widgetKey: string; text: string }) => Promise<PromptDispatchOutcome>;
  /** Pending-approvals slice — only the `approvals` widget consumes it. */
  approvals?: ApprovalsWidgetSource;
};

/** A builtin widget renderer: pure, side-effect-free, throws only on real bugs. */
export type BuiltinWidgetRenderer = (
  widget: DashboardWidget,
  value: unknown,
  ctx: BuiltinWidgetContext,
) => TemplateResult;
