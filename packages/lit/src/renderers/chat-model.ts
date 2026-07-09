// The pure render model for builtin:chat. `reduceChatEvents` folds the raw
// `AgentStreamEvent` stream (SPEC §14.2) into an ordered list of assistant turns,
// each a sequence of render items — markdown text blocks and grouped tool-call
// chips — plus the turn's terminal status. This is where the triad logic lives
// (start → delta* → end keyed by stable ids) and where the ordering invariants are
// defended: the reducer NEVER throws on an out-of-order or duplicate event, it just
// degrades gracefully, because a UI must survive a misbehaving stream.
//
// User messages are NOT part of the event stream (§14 carries only assistant-turn
// events); the renderer overlays the locally-known user text per turnId. Keep this
// module dependency-free (no lit, no strings) so it stays trivially unit-testable.

import type { AgentStreamEvent, ChatErrorInfo, ChatStopReason } from "@boardstate/schema";

/** Lifecycle of one tool call within a turn. */
export type ChatToolCallStatus = "building" | "ready" | "ok" | "error";

/** One `dashboard.*` tool call the agent issued, folded from its start/delta/ready/result events. */
export type ChatToolCall = {
  callId: string;
  name: string;
  /** Parsed args, present once `tool-call-ready` arrives. */
  args?: unknown;
  /** Raw accumulated arg-text deltas — a UI affordance only, never parsed (§14.2). */
  argsText: string;
  status: ChatToolCallStatus;
  ok?: boolean;
  result?: unknown;
  error?: ChatErrorInfo;
};

/** A streamed assistant text block (rendered as markdown). */
export type ChatTextItem = { kind: "text"; id: string; text: string; closed: boolean };
/** A run of consecutive tool calls, rendered as one collapsed group chip. */
export type ChatToolGroupItem = { kind: "tools"; calls: ChatToolCall[] };
/** A provider/agent error surfaced in-transcript. */
export type ChatErrorItem = {
  kind: "error";
  code: string;
  message: string;
  retryable: boolean;
  /** True once the turn continued after this error — the retry actually happened. */
  superseded: boolean;
};
export type ChatItem = ChatTextItem | ChatToolGroupItem | ChatErrorItem;

/** Terminal state of a turn. `streaming` = no `turn-end`/`abort` seen yet (turn is live). */
export type ChatTurnStatus = "streaming" | "complete" | "aborted";

/** One assistant turn as a render model. */
export type ChatTurn = {
  turnId: string;
  items: ChatItem[];
  status: ChatTurnStatus;
  stopReason?: ChatStopReason;
  usage?: { inputTokens: number; outputTokens: number };
};

/** Per-call display mark for the group-chip summary ("✓✓✗"). */
export type ChatToolMark = "ok" | "error" | "pending";

/** The mark a single tool call contributes to its group chip. */
export function chatToolMark(call: ChatToolCall): ChatToolMark {
  if (call.status === "ok") {
    return "ok";
  }
  if (call.status === "error") {
    return "error";
  }
  return "pending";
}

/** Working state for one turn while folding — resolves ids/callIds to their items. */
type TurnWork = {
  turn: ChatTurn;
  textById: Map<string, ChatTextItem>;
  callById: Map<string, ChatToolCall>;
};

function newTurn(turnId: string): TurnWork {
  return {
    turn: { turnId, items: [], status: "streaming" },
    textById: new Map(),
    callById: new Map(),
  };
}

/** The last render item of a turn, or undefined when empty. */
function lastItem(turn: ChatTurn): ChatItem | undefined {
  return turn.items[turn.items.length - 1];
}

/**
 * Mark every still-pending retryable error in the turn as superseded. Called when a
 * continuation event (more text / another tool call / another error) arrives after
 * an error: the turn kept going, so the error WAS retried — the UI shows "retrying…"
 * instead of a final failure.
 */
function markErrorsRetried(turn: ChatTurn): void {
  for (const item of turn.items) {
    if (item.kind === "error" && item.retryable && !item.superseded) {
      item.superseded = true;
    }
  }
}

/** Get (or lazily create) the working turn for an event's turnId. */
function turnFor(work: Map<string, TurnWork>, order: string[], turnId: string): TurnWork {
  let entry = work.get(turnId);
  if (!entry) {
    entry = newTurn(turnId);
    work.set(turnId, entry);
    order.push(turnId);
  }
  return entry;
}

/** Append a tool call to the trailing tools group, or open a new one (grouping breaks on text/error). */
function appendToolCall(turn: ChatTurn, call: ChatToolCall): void {
  const tail = lastItem(turn);
  if (tail && tail.kind === "tools") {
    tail.calls.push(call);
    return;
  }
  turn.items.push({ kind: "tools", calls: [call] });
}

/**
 * Fold a raw `AgentStreamEvent[]` into ordered assistant turns. Pure and total: any
 * out-of-order, duplicate, or orphaned event is absorbed rather than thrown. Turns
 * keep first-seen order; a turnless `error` attaches to the most recent turn (or a
 * synthetic empty-id turn when the stream opens with one).
 */
export function reduceChatEvents(events: readonly AgentStreamEvent[]): ChatTurn[] {
  const work = new Map<string, TurnWork>();
  const order: string[] = [];

  for (const event of events) {
    switch (event.type) {
      case "turn-start": {
        turnFor(work, order, event.turnId);
        break;
      }
      case "text-start": {
        const { turn, textById } = turnFor(work, order, event.turnId);
        markErrorsRetried(turn);
        if (!textById.has(event.id)) {
          const item: ChatTextItem = { kind: "text", id: event.id, text: "", closed: false };
          textById.set(event.id, item);
          turn.items.push(item);
        }
        break;
      }
      case "text-delta": {
        const { turn, textById } = turnFor(work, order, event.turnId);
        markErrorsRetried(turn);
        let item = textById.get(event.id);
        if (!item) {
          // Delta before its start (out-of-order guard): open the block lazily.
          item = { kind: "text", id: event.id, text: "", closed: false };
          textById.set(event.id, item);
          turn.items.push(item);
        }
        item.text += event.delta;
        break;
      }
      case "text-end": {
        const entry = work.get(event.turnId);
        const item = entry?.textById.get(event.id);
        if (item) {
          item.closed = true;
        }
        break;
      }
      case "tool-call-start": {
        const { turn, callById } = turnFor(work, order, event.turnId);
        markErrorsRetried(turn);
        if (!callById.has(event.callId)) {
          const call: ChatToolCall = {
            callId: event.callId,
            name: event.name,
            argsText: "",
            status: "building",
          };
          callById.set(event.callId, call);
          appendToolCall(turn, call);
        }
        break;
      }
      case "tool-call-delta": {
        const call = work.get(event.turnId)?.callById.get(event.callId);
        if (call) {
          call.argsText += event.argsTextDelta;
        }
        break;
      }
      case "tool-call-ready": {
        const { turn, callById } = turnFor(work, order, event.turnId);
        markErrorsRetried(turn);
        let call = callById.get(event.callId);
        if (!call) {
          // Ready without a start (out-of-order guard): materialize the call now.
          call = { callId: event.callId, name: event.name, argsText: "", status: "building" };
          callById.set(event.callId, call);
          appendToolCall(turn, call);
        }
        call.name = event.name;
        call.args = event.args;
        call.status = "ready";
        break;
      }
      case "tool-result": {
        const call = work.get(event.turnId)?.callById.get(event.callId);
        if (call) {
          call.ok = event.ok;
          call.status = event.ok ? "ok" : "error";
          if (event.result !== undefined) {
            call.result = event.result;
          }
          if (event.error !== undefined) {
            call.error = event.error;
          }
        }
        break;
      }
      case "usage": {
        const { turn } = turnFor(work, order, event.turnId);
        turn.usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
        break;
      }
      case "abort": {
        const { turn } = turnFor(work, order, event.turnId);
        turn.status = "aborted";
        break;
      }
      case "turn-end": {
        const { turn } = turnFor(work, order, event.turnId);
        // Guard a duplicate terminal event: the first turn-end wins.
        if (turn.stopReason !== undefined) {
          break;
        }
        turn.stopReason = event.stopReason;
        turn.status = event.stopReason === "aborted" ? "aborted" : "complete";
        break;
      }
      case "error": {
        // A turnless error attaches to the most recent turn, else a synthetic turn.
        const turnId = event.turnId ?? order[order.length - 1] ?? "";
        const { turn } = turnFor(work, order, turnId);
        markErrorsRetried(turn);
        turn.items.push({
          kind: "error",
          code: event.code,
          message: event.message,
          retryable: event.retryable,
          superseded: false,
        });
        break;
      }
      default: {
        // Exhaustiveness guard: an unknown event type is ignored, never thrown.
        break;
      }
    }
  }

  return order.map((turnId) => work.get(turnId)!.turn);
}
