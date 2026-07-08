// The single confirm + rate-limit gate for dispatching a prompt to chat.send.
//
// Both the sandboxed custom-widget bridge (`bridge.ts` `handleSendPrompt`) and a
// trusted `builtin:action-form` widget route through `dispatchRateLimitedPrompt`,
// so there is exactly one dispatch privilege: the rate budget (1 in-flight, 10/min,
// keyed by a stable widget identity) and the per-invocation operator confirm are
// shared, never reimplemented. Extracted from the bridge so the two consumers
// cannot diverge.

const PROMPT_RATE_WINDOW_MS = 60_000;
const PROMPT_RATE_MAX = 10;

/**
 * sendPrompt rate-limit state, keyed by STABLE widget identity (the custom widget
 * name, or a builtin id), NOT the iframe/bridge instance. The host recreates the
 * iframe (and a fresh bridge) on layout drag / tab switch / widget re-add, so
 * per-closure state would let a widget reset its "10/min + 1 in-flight" cap simply
 * by triggering a remount. Persisting this at module scope keyed by name closes
 * that hole: the rolling window survives bridge re-instantiation. Each distinct
 * widget identity has its own independent budget.
 */
export type PromptRateState = { timestamps: number[]; inFlight: boolean };
const promptRateStates = new Map<string, PromptRateState>();

export function getPromptRateState(widgetKey: string): PromptRateState {
  let state = promptRateStates.get(widgetKey);
  if (!state) {
    state = { timestamps: [], inFlight: false };
    promptRateStates.set(widgetKey, state);
  }
  return state;
}

/** Test-only: reset all persisted rate-limit budgets. */
export function resetPromptRateStatesForTest(): void {
  promptRateStates.clear();
}

/** Outcome of a gated prompt dispatch; the caller maps it to UI feedback. */
export type PromptDispatchOutcome = "sent" | "declined" | "rate_limited";

/**
 * The single confirm + rate-limit gate for dispatching a prompt to chat.send.
 * Both the sandboxed custom-widget bridge (`handleSendPrompt`) and the trusted
 * `builtin:action-form` widget route through THIS function, so there is exactly
 * one dispatch privilege: the rate budget (1 in-flight, 10/min, keyed by
 * `widgetKey`) and the per-invocation operator confirm are shared, never
 * reimplemented. The gate order is fixed: rate check → confirm → send.
 */
export async function dispatchRateLimitedPrompt(params: {
  /** Stable widget identity the rate budget is keyed by (custom name or builtin id). */
  widgetKey: string;
  text: string;
  confirmPrompt: (text: string) => Promise<boolean>;
  sendPrompt: (text: string) => Promise<void>;
  now?: () => number;
}): Promise<PromptDispatchOutcome> {
  const now = params.now ?? (() => Date.now());
  const rateState = getPromptRateState(params.widgetKey);
  const cutoff = now() - PROMPT_RATE_WINDOW_MS;
  rateState.timestamps = rateState.timestamps.filter((ts) => ts > cutoff);
  if (rateState.inFlight || rateState.timestamps.length >= PROMPT_RATE_MAX) {
    return "rate_limited";
  }
  rateState.inFlight = true;
  try {
    const confirmed = await params.confirmPrompt(params.text);
    if (!confirmed) {
      // Deny path sends NOTHING and does not consume a rate slot.
      return "declined";
    }
    rateState.timestamps.push(now());
    await params.sendPrompt(params.text);
    return "sent";
  } finally {
    rateState.inFlight = false;
  }
}
