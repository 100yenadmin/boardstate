// Public surface of @boardstate/react: a thin React wrapper over the
// `<boardstate-view>` custom element shipped by `@boardstate/lit`.

export { BoardstateView, type BoardstateViewProps } from "./boardstate-view.js";

// Re-exported for convenience so consumers don't need a separate import from
// `@boardstate/core` / `@boardstate/lit` / `@boardstate/schema` just to type their
// `transport`/`strings` or a chat-event stream (SPEC §14).
export type { Transport } from "@boardstate/core";
export type { BoardstateStrings } from "@boardstate/lit";
export type { AgentStreamEvent } from "@boardstate/schema";
