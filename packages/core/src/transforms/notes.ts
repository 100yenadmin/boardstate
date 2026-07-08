// builtin:notes — the pure state<->text glue for the write-back notes pad. The
// stored blob is the raw string; the host presentation package hydrates a textarea
// from `notesTextFromState` and debounces persistence by `NOTES_PERSIST_DEBOUNCE_MS`.

/** Debounce window before an edit is persisted (ms). */
export const NOTES_PERSIST_DEBOUNCE_MS = 500;

/** Coerce a persisted state blob to the editable text. Stored blob is the raw string. */
export function notesTextFromState(state: unknown): string {
  if (typeof state === "string") {
    return state;
  }
  return "";
}
