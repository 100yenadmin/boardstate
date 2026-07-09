// builtin:chat — the chat FACE of the control plane (SPEC §14). It drives the
// `chat.*` methods through the injected `ctx.chat` seam and renders the
// `AgentStreamEvent` stream; it knows NOTHING about providers or the agent loop.
//
// Unlike the other builtins, chat is a long-lived interactive island: it owns a
// growing event log and a live subscription, so a pure render-per-frame won't do.
// Following the `notes` pattern (per-widget runtime state hydrated via a `ref`
// callback), each widget gets a `ChatController` that mounts on connect, loads
// history, subscribes to live events, and re-renders its own subtree with lit's
// `render()` — independent of the parent view's render cycle, while still absorbing
// fresh `ctx` (e.g. `registryPending`) the parent passes on every doc change.

import { html, nothing, render, type TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { DashboardWidget } from "@boardstate/core";
import type { AgentStreamEvent } from "@boardstate/schema";
import { toSanitizedMarkdownHtml } from "../markdown.js";
import { t } from "../strings.js";
import {
  chatToolMark,
  reduceChatEvents,
  type ChatToolCall,
  type ChatToolGroupItem,
  type ChatTurn,
} from "./chat-model.js";
import type { BuiltinWidgetContext } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * A friendly one-line summary of a tool call, derived from its `dashboard.*` method
 * name + args (SPEC examples). Falls back to the raw method when no heuristic fits.
 */
function friendlyToolLabel(name: string, args: unknown): string {
  const a = isRecord(args) ? args : {};
  const bare = name.startsWith("dashboard.") ? name.slice("dashboard.".length) : name;
  switch (bare) {
    case "tab.create": {
      const label = asString(a.title) || asString(a.slug);
      return label ? t("dashboard.widget.chat.tool.createdTab", { name: label }) : name;
    }
    case "widget.add": {
      const id = asString(a.id) || asString(a.widgetId);
      return id ? t("dashboard.widget.chat.tool.addedWidget", { id }) : name;
    }
    case "workspace.get":
      return t("dashboard.widget.chat.tool.readBoard");
    default:
      return name;
  }
}

/** The "✓✓✗"-style per-call summary string for a tool group's chip. */
function toolGroupMarks(calls: ChatToolCall[]): string {
  return calls
    .map((call) => {
      const mark = chatToolMark(call);
      return mark === "ok" ? "✓" : mark === "error" ? "✗" : "·";
    })
    .join("");
}

function toolActionsLabel(count: number): string {
  return count === 1
    ? t("dashboard.widget.chat.actionsOne")
    : t("dashboard.widget.chat.actionsMany", { count: String(count) });
}

/** Pretty-print an args/result payload for the expandable detail rows. */
function formatPayload(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Render one tool call as a log row: a shimmer while building, else name + JSON details. */
function renderToolRow(call: ChatToolCall, aborted: boolean): TemplateResult {
  const building = (call.status === "building" || call.status === "ready") && !call.ok;
  if (building && !aborted) {
    return html`<div class="dashboard-chat__tool-row dashboard-chat__tool-row--building">
      <span class="dashboard-chat__shimmer"></span>
      <span class="dashboard-chat__tool-name">${friendlyToolLabel(call.name, call.args)}</span>
      <span class="dashboard-chat__tool-note">${t("dashboard.widget.chat.building")}</span>
    </div>`;
  }
  const mark = chatToolMark(call);
  const hasArgs = call.args !== undefined || call.argsText.length > 0;
  const hasResult = call.result !== undefined || call.error !== undefined;
  return html`<div
    class="dashboard-chat__tool-row"
    data-status=${aborted && building ? "cancelled" : mark}
  >
    <span class="dashboard-chat__tool-name">
      <span class="dashboard-chat__tool-mark" aria-hidden="true"
        >${mark === "ok" ? "✓" : mark === "error" ? "✗" : "·"}</span
      >
      ${friendlyToolLabel(call.name, call.args)}
    </span>
    ${
      hasArgs
        ? html`<details class="dashboard-chat__tool-detail">
            <summary>${t("dashboard.widget.chat.args")}</summary>
            <pre>${call.args !== undefined ? formatPayload(call.args) : call.argsText}</pre>
          </details>`
        : nothing
    }
    ${
      hasResult
        ? html`<details class="dashboard-chat__tool-detail">
            <summary>${t("dashboard.widget.chat.result")}</summary>
            <pre>${formatPayload(call.error ?? call.result)}</pre>
          </details>`
        : nothing
    }
  </div>`;
}

/** Render a run of consecutive tool calls as one collapsed group chip. */
function renderToolGroup(group: ChatToolGroupItem, aborted: boolean): TemplateResult {
  const count = group.calls.length;
  return html`<details class="dashboard-chat__tools" data-test-id="dashboard-chat-tools">
    <summary class="dashboard-chat__chip">
      <span aria-hidden="true">🔧</span>
      <span class="dashboard-chat__chip-count">${toolActionsLabel(count)}</span>
      <span class="dashboard-chat__chip-sep" aria-hidden="true">·</span>
      <span class="dashboard-chat__chip-marks">${toolGroupMarks(group.calls)}</span>
    </summary>
    <div class="dashboard-chat__tool-log">
      ${group.calls.map((call) => renderToolRow(call, aborted))}
    </div>
  </details>`;
}

/** Render one assistant turn: a role label plus its interleaved text/tool/error items. */
function renderAssistantTurn(turn: ChatTurn): TemplateResult {
  const aborted = turn.status === "aborted";
  return html`<div
    class="dashboard-chat__turn dashboard-chat__turn--assistant"
    data-test-id="dashboard-chat-turn"
    data-status=${turn.status}
  >
    <div class="dashboard-chat__role">${t("dashboard.widget.chat.roleAssistant")}</div>
    ${turn.items.map((item) => {
      if (item.kind === "text") {
        return html`<div class="dashboard-chat__text markdown-body">
          ${unsafeHTML(toSanitizedMarkdownHtml(item.text))}
        </div>`;
      }
      if (item.kind === "tools") {
        return renderToolGroup(item, aborted);
      }
      return html`<div
        class="dashboard-chat__error"
        role="alert"
        data-test-id="dashboard-chat-error"
      >
        <span class="dashboard-chat__error-message">${item.message}</span>
        ${
          item.retryable && item.superseded
            ? html`<span class="dashboard-chat__error-retry"
                >${t("dashboard.widget.chat.retrying")}</span
              >`
            : nothing
        }
      </div>`;
    })}
  </div>`;
}

/** Render a user message bubble (plain text, left-aligned, role-labelled). */
function renderUserTurn(text: string): TemplateResult {
  return html`<div
    class="dashboard-chat__turn dashboard-chat__turn--user"
    data-test-id="dashboard-chat-user"
  >
    <div class="dashboard-chat__role">${t("dashboard.widget.chat.roleUser")}</div>
    <div class="dashboard-chat__text">${text}</div>
  </div>`;
}

/** The distance-from-bottom (px) within which the transcript sticks to the newest content. */
const STICK_TO_BOTTOM_PX = 100;

/**
 * The per-widget interactive island. One instance per widget id (keyed in the
 * module map below); it holds the event log + live subscription and re-renders its
 * own subtree. The parent view feeds a fresh `ctx` on every doc change via
 * `setContext`, keeping `registryPending` (the inline approval card) current.
 */
class ChatController {
  private root: HTMLElement | null = null;
  private ctx: BuiltinWidgetContext | null = null;
  private widget: DashboardWidget | null = null;
  private events: AgentStreamEvent[] = [];
  private unsubscribe: (() => void) | null = null;
  /** turnId → the local user message that started it (never in the event stream). */
  private readonly userMessages = new Map<string, string>();
  /** An in-flight send not yet resolved to a turnId (optimistic bubble). */
  private pendingUserText: string | null = null;
  private sending = false;
  /** Whether the transcript is pinned to the newest content (autoscroll). */
  private stickToBottom = true;

  constructor(private readonly widgetId: string) {}

  /** `ref` callback for the outer container: mount on connect, tear down on removal. */
  readonly rootRef = (element: Element | undefined): void => {
    if (element instanceof HTMLElement) {
      this.mount(element);
    } else {
      this.destroy();
    }
  };

  /** Store the latest render context/widget (parent re-render) and refresh the island. */
  setContext(ctx: BuiltinWidgetContext, widget: DashboardWidget): void {
    this.ctx = ctx;
    this.widget = widget;
    if (this.root) {
      this.renderIsland();
    }
  }

  private mount(element: HTMLElement): void {
    this.root = element;
    // A fresh element means a fresh mount: reset any prior subscription/state.
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.events = [];
    this.userMessages.clear();
    this.pendingUserText = null;
    this.sending = false;
    this.stickToBottom = true;
    this.renderIsland();
    const chat = this.ctx?.chat;
    if (!chat) {
      return;
    }
    void chat
      .history()
      .then((events) => {
        // History replaces the (empty) log; live events already queued append after.
        this.events = [...events, ...this.events];
        this.renderIsland();
      })
      .catch(() => {
        // A failed history load leaves an empty transcript — the widget stays usable.
      });
    this.unsubscribe = chat.subscribe((event) => {
      this.events.push(event);
      this.renderIsland();
    });
  }

  private destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.root = null;
    controllers.delete(this.widgetId);
  }

  private liveTurnId(turns: ChatTurn[]): string | undefined {
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      if (turns[i]!.status === "streaming") {
        return turns[i]!.turnId;
      }
    }
    return undefined;
  }

  private onSubmit = (event: Event): void => {
    event.preventDefault();
    this.send();
  };

  private onTextareaKey = (event: KeyboardEvent): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  };

  private send(): void {
    const chat = this.ctx?.chat;
    const textarea = this.root?.querySelector<HTMLTextAreaElement>(".dashboard-chat__textarea");
    if (!chat || !textarea) {
      return;
    }
    const message = textarea.value.trim();
    if (!message || this.sending) {
      return;
    }
    textarea.value = "";
    this.pendingUserText = message;
    this.sending = true;
    this.stickToBottom = true;
    this.renderIsland();
    void chat
      .send(message)
      .then(({ turnId }) => {
        this.userMessages.set(turnId, message);
      })
      .catch(() => {
        // A failed send drops the optimistic bubble; the stream's error event (if
        // any) surfaces separately in-transcript.
      })
      .finally(() => {
        this.pendingUserText = null;
        this.sending = false;
        this.renderIsland();
      });
  }

  private onStop = (turnId: string): void => {
    void this.ctx?.chat?.abort(turnId).catch(() => {
      // Abort is best-effort; the host still emits the terminal turn-end.
    });
  };

  private onScroll = (event: Event): void => {
    const el = event.currentTarget as HTMLElement;
    this.stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX;
    this.updateJumpPill();
  };

  private jumpToLatest = (): void => {
    const scroll = this.root?.querySelector<HTMLElement>(".dashboard-chat__scroll");
    if (scroll) {
      this.stickToBottom = true;
      scroll.scrollTop = scroll.scrollHeight;
      this.updateJumpPill();
    }
  };

  private updateJumpPill(): void {
    const pill = this.root?.querySelector<HTMLElement>(".dashboard-chat__jump");
    if (pill) {
      pill.hidden = this.stickToBottom;
    }
  }

  private renderIsland(): void {
    if (!this.root) {
      return;
    }
    const turns = reduceChatEvents(this.events);
    const liveTurnId = this.liveTurnId(turns);
    const isLive = liveTurnId !== undefined || this.sending;
    const pending = this.ctx?.registryPending ?? [];
    const canApprove = Boolean(this.ctx?.approveWidget);
    const showApprovals = isLive && canApprove && pending.length > 0;
    const empty = turns.length === 0 && this.pendingUserText === null;
    const disconnected = !this.ctx?.chat;

    render(
      html`
        <div class="dashboard-chat__scroll" @scroll=${this.onScroll}>
          ${
            empty
              ? html`<div class="dashboard-chat__empty" data-test-id="dashboard-chat-empty">
                  ${t("dashboard.widget.chat.empty")}
                </div>`
              : nothing
          }
          ${turns.map((turn) => {
            const userText = this.userMessages.get(turn.turnId);
            return html`${userText !== undefined ? renderUserTurn(userText) : nothing}
            ${renderAssistantTurn(turn)}`;
          })}
          ${this.pendingUserText !== null ? renderUserTurn(this.pendingUserText) : nothing}
          ${
            showApprovals
              ? pending.map(
                  (name) =>
                    html`<div
                      class="dashboard-chat__approval"
                      data-test-id="dashboard-chat-approval"
                    >
                      <span class="dashboard-chat__approval-title"
                        >${t("dashboard.widget.chat.approveTitle", { name })}</span
                      >
                      <span class="dashboard-chat__approval-actions">
                        <button
                          class="bs-btn bs-btn--small bs-btn--primary"
                          type="button"
                          data-test-id="dashboard-chat-approve"
                          @click=${() => this.ctx?.approveWidget?.(name, "approved")}
                        >
                          ${t("dashboard.widget.chat.approve")}
                        </button>
                        <button
                          class="bs-btn bs-btn--small"
                          type="button"
                          data-test-id="dashboard-chat-reject"
                          @click=${() => this.ctx?.approveWidget?.(name, "rejected")}
                        >
                          ${t("dashboard.widget.chat.reject")}
                        </button>
                      </span>
                    </div>`,
                )
              : nothing
          }
        </div>
        <button
          class="dashboard-chat__jump"
          type="button"
          hidden
          data-test-id="dashboard-chat-jump"
          @click=${this.jumpToLatest}
        >
          ${t("dashboard.widget.chat.jumpToLatest")} ↓
        </button>
        <form class="dashboard-chat__input" @submit=${this.onSubmit}>
          <textarea
            class="dashboard-chat__textarea"
            data-test-id="dashboard-chat-textarea"
            rows="2"
            ?disabled=${disconnected}
            placeholder=${this.placeholder()}
            @keydown=${this.onTextareaKey}
          ></textarea>
          <div class="dashboard-chat__input-actions">
            ${
              liveTurnId !== undefined
                ? html`<button
                    class="bs-btn bs-btn--small dashboard-chat__stop"
                    type="button"
                    data-test-id="dashboard-chat-stop"
                    @click=${() => this.onStop(liveTurnId)}
                  >
                    ${t("dashboard.widget.chat.stop")}
                  </button>`
                : nothing
            }
            <button
              class="bs-btn bs-btn--small bs-btn--primary dashboard-chat__send"
              type="submit"
              data-test-id="dashboard-chat-send"
              ?disabled=${disconnected}
            >
              ${t("dashboard.widget.chat.send")}
            </button>
          </div>
        </form>
        ${
          disconnected
            ? html`<div class="dashboard-chat__hint" data-test-id="dashboard-chat-disconnected">
                ${t("dashboard.widget.chat.disconnected")}
              </div>`
            : nothing
        }
      `,
      this.root,
    );
    if (this.stickToBottom) {
      const scroll = this.root.querySelector<HTMLElement>(".dashboard-chat__scroll");
      if (scroll) {
        scroll.scrollTop = scroll.scrollHeight;
      }
    }
    this.updateJumpPill();
  }

  private placeholder(): string {
    const props = isRecord(this.widget?.props) ? this.widget.props : {};
    const custom = asString(props.placeholder);
    return custom || t("dashboard.widget.chat.placeholder");
  }
}

/** One live controller per widget id. Created lazily; removed on the widget's unmount. */
const controllers = new Map<string, ChatController>();

/**
 * Renders builtin:chat. The renderer stays a pure function returning the island's
 * container; the `ChatController` (keyed by widget id) owns the interactive state
 * and its own render loop, hydrated via the `ref` callback (the `notes` pattern).
 */
export function renderChat(
  widget: DashboardWidget,
  _value: unknown,
  ctx: BuiltinWidgetContext,
): TemplateResult {
  let controller = controllers.get(widget.id);
  if (!controller) {
    controller = new ChatController(widget.id);
    controllers.set(widget.id, controller);
  }
  controller.setContext(ctx, widget);
  return html`<div
    class="dashboard-chat"
    data-test-id="dashboard-chat"
    ${ref(controller.rootRef)}
  ></div>`;
}
