// The definition-token budget (issue #42, red-team fix). The runner ships every tool's
// full name+description+schema on EVERY provider turn, and `truncateHistory` only elides
// tool RESULTS — never the DEFINITIONS. Once external (broker-granted) tools land, a
// single connector's catalog can dwarf the whole prompt (GitHub's MCP alone ≈42k tokens).
//
// So we cap the shipped definitions. CORE `dashboard_*` tools are always shipped in full
// (they are small and load-bearing). COLLAPSIBLE tools (the external granted set) are kept
// in full most-recently-used-first until the budget is spent; the rest collapse to a
// name + a one-line summary + a "call boardstate_tool_search to expand" hint. A collapsed
// tool stays CALLABLE — only its advertised schema shrinks (the runner executes against
// the full tool set), so the model can always re-expand and use it next turn.

import type { ProviderTool } from "./types.js";

/** A provider tool tagged with whether the budget may collapse it (external ⇒ collapsible). */
export type BudgetableToolDef = ProviderTool & { collapsible: boolean };

/** The hint appended to a collapsed tool so the model knows how to recover the full schema. */
export const COLLAPSED_TOOL_HINT =
  "(schema collapsed to save context — call boardstate_tool_search to expand this tool before using it)";

/**
 * A cheap, dependency-free token estimate for one shipped tool definition (~4 chars/token),
 * matching the heuristic `chat-agent.ts` uses for history so the two budgets speak the same
 * unit.
 */
export function estimateToolDefTokens(def: ProviderTool): number {
  return Math.ceil(JSON.stringify(def).length / 4);
}

/** Collapse a long description to a single line (first sentence, hard-capped), newline-free. */
function oneLineSummary(description: string): string {
  const flat = description.replace(/\s+/g, " ").trim();
  const firstSentence = flat.split(". ")[0] ?? flat;
  const base = firstSentence.length <= 140 ? firstSentence : `${flat.slice(0, 137)}...`;
  return base;
}

/** Build the collapsed form of a tool def: name kept, minimal schema, summary + recovery hint. */
function collapse(def: ProviderTool): ProviderTool {
  const summary = def.description ? oneLineSummary(def.description) : "";
  const description = summary ? `${summary} ${COLLAPSED_TOOL_HINT}` : COLLAPSED_TOOL_HINT;
  return { name: def.name, description, parameters: { type: "object" } };
}

/**
 * Apply the definition-token budget. Returns the defs to actually ship this turn, in the
 * SAME order they arrived (stable prompt), keeping the ESTIMATED TOTAL at or under
 * `maxTokens` whenever possible.
 *
 * - Pinned (non-collapsible) tools are ALWAYS shipped in full.
 * - The floor is every collapsible tool collapsed (pinned-full + all stubs). From there,
 *   collapsible tools are UPGRADED back to their full schema most-recently-used first
 *   (`mru` is most-recently-used first; unranked tools follow in arrival order) while the
 *   running total stays within budget — so the total, stubs included, never exceeds the
 *   cap unless even the floor already does (nothing more can be shed).
 * - If everything already fits in full, the input is returned untouched.
 */
export function applyToolDefBudget(
  defs: BudgetableToolDef[],
  opts: { maxTokens: number; mru?: readonly string[] },
): ProviderTool[] {
  const plain = defs.map(({ collapsible: _collapsible, ...def }) => def);
  const total = plain.reduce((sum, def) => sum + estimateToolDefTokens(def), 0);
  if (total <= opts.maxTokens) {
    return plain;
  }

  const mruRank = new Map<string, number>();
  (opts.mru ?? []).forEach((name, index) => {
    if (!mruRank.has(name)) {
      mruRank.set(name, index);
    }
  });

  // Baseline: pinned tools full, every collapsible tool collapsed to its stub.
  const stubs = new Map<string, ProviderTool>();
  let running = 0;
  for (const def of defs) {
    if (def.collapsible) {
      const stub = collapse(def);
      stubs.set(def.name, stub);
      running += estimateToolDefTokens(stub);
    } else {
      running += estimateToolDefTokens(def);
    }
  }

  // Upgrade collapsible tools back to full, MRU-first, while the total stays in budget.
  const collapsible = defs.filter((def) => def.collapsible);
  const order = [...collapsible.keys()].sort((a, b) => {
    const rankA = mruRank.get(collapsible[a]!.name) ?? Number.POSITIVE_INFINITY;
    const rankB = mruRank.get(collapsible[b]!.name) ?? Number.POSITIVE_INFINITY;
    return rankA !== rankB ? rankA - rankB : a - b;
  });
  const keepFull = new Set<string>();
  for (const index of order) {
    const def = collapsible[index]!;
    const upgradeCost = estimateToolDefTokens(def) - estimateToolDefTokens(stubs.get(def.name)!);
    if (running + upgradeCost <= opts.maxTokens) {
      running += upgradeCost;
      keepFull.add(def.name);
    }
  }

  return defs.map((def) =>
    !def.collapsible || keepFull.has(def.name)
      ? { name: def.name, description: def.description, parameters: def.parameters }
      : stubs.get(def.name)!,
  );
}
