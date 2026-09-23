// builtin:notes — an editable notes/todo pad persisted via the write-back state
// store. Builtins render in the TRUSTED control UI (not the sandboxed iframe), so
// this reaches the state accessor directly through `ctx.state` — the host binds
// that accessor to THIS widget's id, so the renderer never names an id.
//
// Renderers are stateless: interactivity lives in the DOM via a `ref()` callback
// that hydrates the textarea from `ctx.state.get()` on mount and wires a debounced
// `ctx.state.set()` on input. Without `ctx.state` (no transport) the pad degrades
// to read-only with a hint. The debounce constant lives in `@boardstate/core`.

import { html, type TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";
import { NOTES_PERSIST_DEBOUNCE_MS, widgetProps, type DashboardWidget } from "@boardstate/core";
import { t } from "../strings.js";
import type { BuiltinWidgetContext, BuiltinWidgetState } from "./types.js";

/** Seed text from `props` when there is no persisted state yet (author-provided default). */
function notesSeedText(widget: DashboardWidget): string {
  const props = widgetProps(widget);
  if (typeof props.text === "string") {
    return props.text;
  }
  return "";
}

/**
 * Callback ref that shows the author/agent `seed` at once, hydrates the textarea
 * from the widget's persisted state, then wires debounced persistence on input. A
 * persisted string (even an empty one the user saved) wins over the seed; the seed
 * is never written back until the user edits. The `ref` directive calls this with the
 * element on connect (and `undefined` on disconnect). All state errors are
 * swallowed: a failed load/save leaves the pad usable rather than throwing into
 * the cell's error boundary.
 */
function bindNotesEditor(
  state: BuiltinWidgetState,
  seed: string,
): (element: Element | undefined) => void {
  return (element) => {
    if (!(element instanceof HTMLTextAreaElement)) {
      return;
    }
    const textarea = element;
    // Guard against a double-bind (Lit may call the ref again on re-render).
    if (textarea.dataset.notesBound === "1") {
      return;
    }
    textarea.dataset.notesBound = "1";
    textarea.value = seed;

    void state
      .get()
      .then((result) => {
        // Only hydrate if the user hasn't started typing before the load resolved.
        if (textarea.dataset.notesDirty !== "1") {
          textarea.value = typeof result.state === "string" ? result.state : seed;
        }
      })
      .catch(() => {
        // A failed hydrate keeps the seed/empty value — the pad stays editable.
      });

    let timer: ReturnType<typeof setTimeout> | undefined;
    textarea.addEventListener("input", () => {
      textarea.dataset.notesDirty = "1";
      const next = textarea.value;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        void state.set(next).catch(() => {
          // A failed save is non-fatal; the next edit retries.
        });
      }, NOTES_PERSIST_DEBOUNCE_MS);
    });
  };
}

export function renderNotes(
  widget: DashboardWidget,
  _value: unknown,
  ctx: BuiltinWidgetContext,
): TemplateResult {
  const placeholder = t("dashboard.widget.notes.placeholder");
  if (!ctx.state) {
    // No transport → no persistence. Degrade to a read-only view of any
    // author-seeded text with a hint, rather than an editable pad that silently
    // drops every edit.
    const seed = notesSeedText(widget);
    return html`
      <div class="dashboard-notes dashboard-notes--readonly" data-test-id="dashboard-notes">
        <textarea
          class="dashboard-notes__pad"
          data-test-id="dashboard-notes-pad"
          readonly
          aria-label=${widget.title}
          placeholder=${placeholder}
        >
${seed}</textarea>
        <div class="dashboard-notes__hint" data-test-id="dashboard-notes-hint">
          ${t("dashboard.widget.notes.readonlyHint")}
        </div>
      </div>
    `;
  }
  return html`
    <div class="dashboard-notes" data-test-id="dashboard-notes">
      <textarea
        class="dashboard-notes__pad"
        data-test-id="dashboard-notes-pad"
        aria-label=${widget.title}
        placeholder=${placeholder}
        ${ref(bindNotesEditor(ctx.state, notesSeedText(widget)))}
      ></textarea>
    </div>
  `;
}
