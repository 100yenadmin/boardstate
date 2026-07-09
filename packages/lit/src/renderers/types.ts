// Contract for the builtin widget renderers. Each builtin is a pure render
// function keyed by its kind (`builtin:<name>`); the widget cell dispatches through
// the registry (`./index.ts`). The data-shape `map*` transforms live in
// `@boardstate/core` (imported by each renderer) — renderers only turn an
// already-resolved value into DOM, and throw only on real bugs.

import type { TemplateResult } from "lit";
import type { ApprovalsWidgetSource, DashboardWidget } from "@boardstate/core";
import type { PromptDispatchOutcome } from "@boardstate/host";
import type { AgentStreamEvent } from "@boardstate/schema";

/**
 * The chat control-plane seam the `builtin:chat` widget drives (SPEC §14). It is the
 * chat FACE only: it starts/aborts turns and reads the live `AgentStreamEvent`
 * stream, and knows NOTHING about providers. The view binds all four methods to a
 * single `sessionKey` and filters the broadcast bus to it. Present only when a live
 * transport exists; absent renders the widget's disconnected state.
 */
export type BuiltinChatSeam = {
  /** Start an agent turn (`chat.send`); resolves with the new turn's id. */
  send(message: string): Promise<{ turnId: string }>;
  /** Request cancellation of a live turn (`chat.abort`). */
  abort(turnId: string): Promise<void>;
  /** The retained event ring for this session (`chat.history.get`), for remount. */
  history(): Promise<AgentStreamEvent[]>;
  /** Subscribe to this session's live events; returns an unsubscribe fn. */
  subscribe(listener: (event: AgentStreamEvent) => void): () => void;
};

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
  /**
   * Surface a widget-action failure on the view's shared toast (`state.actionError`,
   * the SAME banner export/import failures use). The action-form widget calls this
   * when a prompt dispatch rejects. Absent in isolated unit renders.
   */
  onActionError?: (message: string) => void;
  /** Pending-approvals slice — only the `approvals` widget consumes it. */
  approvals?: ApprovalsWidgetSource;
  /**
   * The chat control-plane seam — only the `chat` widget consumes it. Present only
   * when a live transport exists; absent renders the chat widget's disconnected hint.
   */
  chat?: BuiltinChatSeam;
  /**
   * Names of `custom:` widgets currently `pending` approval, read from the live
   * workspace registry. The `chat` widget shows an inline approval card for each
   * during a live turn (a freshly scaffolded widget). Re-supplied on every doc
   * change (the view re-renders builtins then), so it stays current.
   */
  registryPending?: string[];
  /**
   * Approve/reject a pending scaffolded widget by name (`dashboard.widget.approve`),
   * driving the same write path the approvals widget uses. The `chat` widget's
   * inline approval card consumes it; absent when there is no live transport.
   */
  approveWidget?: (name: string, decision: "approved" | "rejected") => void;
};

/** A builtin widget renderer: pure, side-effect-free, throws only on real bugs. */
export type BuiltinWidgetRenderer = (
  widget: DashboardWidget,
  value: unknown,
  ctx: BuiltinWidgetContext,
) => TemplateResult;
