// Contract for the builtin widget renderers. Each builtin is a pure render
// function keyed by its kind (`builtin:<name>`); the widget cell dispatches through
// the registry (`./index.ts`). The data-shape `map*` transforms live in
// `@boardstate/core` (imported by each renderer) — renderers only turn an
// already-resolved value into DOM, and throw only on real bugs.

import type { TemplateResult } from "lit";
import type { DashboardWidget } from "@boardstate/core";

/** Ambient context a builtin may need beyond its own binding value. */
export type BuiltinWidgetContext = {
  /** Embed policy — only the iframe-embed widget consumes it. */
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
};

/** A builtin widget renderer: pure, side-effect-free, throws only on real bugs. */
export type BuiltinWidgetRenderer = (
  widget: DashboardWidget,
  value: unknown,
  ctx: BuiltinWidgetContext,
) => TemplateResult;
