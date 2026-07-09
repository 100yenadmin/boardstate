// A tiny header widget that watches `CHAT_EVENT` usage events and tallies tokens +
// an ESTIMATED spend for the session. It's a client of the same broadcast bus the
// chat widget reads — no privileged hook. Usage events are cumulative WITHIN a turn
// (SPEC §14.2), so we key the latest value by turnId and sum across turns.

import { CHAT_EVENT, type AgentStreamEvent } from "@boardstate/schema";

/** The `host.addEventListener` surface we depend on. */
interface EventSource {
  addEventListener(event: string, fn: (payload: unknown) => void): () => void;
}

/** $/Mtok (input, output). CLEARLY ESTIMATES — public list prices drift; not billing. */
const RATES: Array<{ match: RegExp; in: number; out: number }> = [
  { match: /glm/i, in: 0.6, out: 2.2 },
  { match: /opus/i, in: 15, out: 75 },
  { match: /sonnet/i, in: 3, out: 15 },
  { match: /haiku/i, in: 0.8, out: 4 }, // estimate — not in the brief
  { match: /gpt-5\.5/i, in: 1.25, out: 10 },
  { match: /gpt/i, in: 1.25, out: 10 }, // gpt-5.4 and other GPTs — estimate
  { match: /llama|qwen|ollama/i, in: 0, out: 0 }, // local: no per-token cost
];

function rateFor(model: string | null): { in: number; out: number } | null {
  if (!model) return null;
  return RATES.find((rate) => rate.match.test(model)) ?? null;
}

/** "12.3k" / "940" — compact token counts. */
function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

export interface CostMeter {
  /** Point the estimate at the active model's rate (null ⇒ unknown / mock, no $). */
  setModel(model: string | null): void;
  /** Zero the tally (e.g. a fresh provider connection). */
  reset(): void;
}

/**
 * Wire a cost meter into `element`, tallying the "app" session's usage. Returns a
 * handle the provider picker uses to point it at the connected model's rate.
 */
export function createCostMeter(
  host: EventSource,
  element: HTMLElement,
  sessionKey = "app",
): CostMeter {
  // turnId → the latest (cumulative) usage for that turn.
  const perTurn = new Map<string, { inputTokens: number; outputTokens: number }>();
  let rate: { in: number; out: number } | null = null;

  const totals = (): { input: number; output: number } => {
    let input = 0;
    let output = 0;
    for (const usage of perTurn.values()) {
      input += usage.inputTokens;
      output += usage.outputTokens;
    }
    return { input, output };
  };

  const paint = (): void => {
    const { input, output } = totals();
    const cost = rate ? (input / 1e6) * rate.in + (output / 1e6) * rate.out : null;
    const costText =
      cost === null ? "" : ` · ~$${cost < 0.01 && cost > 0 ? cost.toFixed(3) : cost.toFixed(2)}`;
    element.textContent = `${fmtTokens(input)}↑ ${fmtTokens(output)}↓${costText}`;
    const rateNote = rate
      ? `Rate (est): $${rate.in}/Mtok in · $${rate.out}/Mtok out`
      : "Cost estimate available once a paid model is connected";
    element.title =
      `Session usage — ${input.toLocaleString()} input · ${output.toLocaleString()} output tokens.\n` +
      `${rateNote}. Estimates only; not a bill.`;
    element.hidden = input === 0 && output === 0 && rate === null;
  };

  host.addEventListener(CHAT_EVENT, (payload) => {
    const event = payload as AgentStreamEvent;
    if (event.type !== "usage" || event.sessionKey !== sessionKey) return;
    perTurn.set(event.turnId, {
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
    });
    paint();
  });

  paint();

  return {
    setModel(model: string | null): void {
      rate = rateFor(model);
      paint();
    },
    reset(): void {
      perTurn.clear();
      paint();
    },
  };
}
