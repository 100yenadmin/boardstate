// The definition-token budget (issue #42): pinned core tools always ship in full, the
// external granted set collapses most-recently-used-LAST once the estimate overflows, and
// a collapsed def keeps its name + a recovery hint so the tool stays callable/expandable.

import { describe, expect, it } from "vitest";
import type { AgentStreamEvent } from "@boardstate/schema";
import { toolJson, type AgentTool } from "@boardstate/server";
import {
  applyToolDefBudget,
  COLLAPSED_TOOL_HINT,
  estimateToolDefTokens,
  type BudgetableToolDef,
} from "./tool-budget.js";
import { runAgentTurn } from "./runner.js";
import type { ProviderAdapter, ProviderDelta, ProviderTool } from "./types.js";

/** A big schema so a single external tool def is expensive to ship (mimics GitHub's MCP). */
function bigSchema(seed: string): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (let i = 0; i < 40; i++) {
    properties[`${seed}_field_${i}`] = {
      type: "string",
      description: `A verbose field describing ${seed} parameter number ${i} in tedious detail.`,
    };
  }
  return { type: "object", additionalProperties: false, properties };
}

function extDef(name: string): BudgetableToolDef {
  return {
    name,
    description: `The ${name} external tool. It does a great many things across many systems.`,
    parameters: bigSchema(name),
    collapsible: true,
  };
}

function coreDef(name: string): BudgetableToolDef {
  return {
    name,
    description: "A core dashboard tool.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    collapsible: false,
  };
}

const totalTokens = (defs: ProviderTool[]): number =>
  defs.reduce((sum, def) => sum + estimateToolDefTokens(def), 0);

const isCollapsed = (def: ProviderTool): boolean => def.description.includes(COLLAPSED_TOOL_HINT);

describe("applyToolDefBudget", () => {
  it("returns everything in full when the defs already fit", () => {
    const defs = [coreDef("core"), extDef("a")];
    const out = applyToolDefBudget(defs, { maxTokens: 1_000_000 });
    expect(out).toHaveLength(2);
    expect(out.some(isCollapsed)).toBe(false);
    // Content matches the plain defs (collapsible flag stripped).
    expect(out[1]).toEqual({
      name: "a",
      description: defs[1]!.description,
      parameters: defs[1]!.parameters,
    });
  });

  it("keeps the prompt under the cap, retaining MRU tools in full and collapsing the rest", () => {
    const defs = [coreDef("core"), extDef("a"), extDef("b"), extDef("c"), extDef("d"), extDef("e")];
    const plain = defs.map(({ collapsible: _c, ...def }) => def);
    const fullTotal = totalTokens(plain);
    // Half the full budget: too small for all five externals, comfortably above the
    // all-collapsed floor — so the greedy keeps a couple and collapses the rest.
    const maxTokens = Math.floor(fullTotal / 2);

    const out = applyToolDefBudget(defs, { maxTokens, mru: ["d", "b"] });
    const byName = new Map(out.map((def) => [def.name, def]));

    // The core guarantee: the shipped total stays within the cap.
    expect(totalTokens(out)).toBeLessThanOrEqual(maxTokens);
    // Pinned core is never collapsed.
    expect(isCollapsed(byName.get("core")!)).toBe(false);
    // Mixed outcome (the test is meaningful), and the two MRU externals keep full schemas.
    expect(out.some(isCollapsed)).toBe(true);
    expect(isCollapsed(byName.get("d")!)).toBe(false);
    expect(isCollapsed(byName.get("b")!)).toBe(false);
    // Unranked externals (not in the MRU) are the ones sacrificed first.
    expect(isCollapsed(byName.get("a")!)).toBe(true);
  });

  it("collapses a def to a named stub with the search hint and a minimal schema", () => {
    const defs = [extDef("a"), extDef("b")];
    const out = applyToolDefBudget(defs, { maxTokens: 1, mru: ["a"] });
    const collapsed = out.find((def) => def.name === "b")!;
    expect(collapsed.name).toBe("b");
    expect(collapsed.description).toContain(COLLAPSED_TOOL_HINT);
    expect(collapsed.parameters).toEqual({ type: "object" });
  });

  it("preserves arrival order in the output", () => {
    const defs = [extDef("a"), coreDef("core"), extDef("b")];
    const out = applyToolDefBudget(defs, { maxTokens: 1 });
    expect(out.map((def) => def.name)).toEqual(["a", "core", "b"]);
  });
});

// --- runner integration: the budget engages only with an external tool, MRU-aware ---

/** A provider that records the tool defs shipped on each turn, then calls `callName` once. */
function recordingAdapter(callName: string | null): {
  adapter: ProviderAdapter;
  shipped: ProviderTool[][];
} {
  const shipped: ProviderTool[][] = [];
  let call = 0;
  const adapter: ProviderAdapter = {
    id: "rec",
    async *streamTurn(request): AsyncIterable<ProviderDelta> {
      shipped.push(request.tools);
      const n = call;
      call += 1;
      if (n === 0 && callName) {
        yield { kind: "tool-call-ready", callId: "c0", name: callName, args: {} };
        yield { kind: "stop", reason: "tool_use" };
        return;
      }
      yield { kind: "stop", reason: "end" };
    },
    formatToolResult: (callId, outcome) => ({
      role: "tool",
      tool_call_id: callId,
      content: JSON.stringify(outcome.value),
    }),
    formatAssistantTurn: (turn) => ({ role: "assistant", content: turn.text }),
  };
  return { adapter, shipped };
}

function makeTool(name: string, external: boolean): AgentTool {
  return {
    name,
    label: name,
    description: `The ${name} tool with a long-winded explanation of everything it can do everywhere.`,
    // Only external tools carry heavy schemas; core tools stay small (as in production).
    parameters: (external
      ? bigSchema(name)
      : { type: "object", additionalProperties: false, properties: {} }) as never,
    readOnly: true,
    external,
    execute: () => toolJson({ ok: true }),
  };
}

const runTurn = (
  adapter: ProviderAdapter,
  tools: AgentTool[],
  overrides: Partial<Parameters<typeof runAgentTurn>[0]> = {},
) => {
  const events: AgentStreamEvent[] = [];
  return runAgentTurn({
    tools,
    provider: adapter,
    system: "sys",
    userMessage: "go",
    emit: (event: AgentStreamEvent) => events.push(event),
    signal: new AbortController().signal,
    sessionKey: "s1",
    turnId: "t1",
    tokenCeiling: 1_000_000,
    sleep: () => Promise.resolve(),
    ...overrides,
  });
};

describe("runAgentTurn — definition-token budget", () => {
  it("ships every definition verbatim when no external tool is present (byte-identical)", async () => {
    const tools = [makeTool("dashboard_core_a", false), makeTool("dashboard_core_b", false)];
    const { adapter, shipped } = recordingAdapter(null);
    await runTurn(adapter, tools, { toolDefTokenBudget: 1 });
    // Budget inert without a collapsible tool: both defs shipped in full.
    expect(shipped[0]!.some((def) => def.description.includes(COLLAPSED_TOOL_HINT))).toBe(false);
    expect(shipped[0]).toHaveLength(2);
  });

  it("collapses external tools over budget but keeps a tool used earlier in the turn", async () => {
    const tools = [
      makeTool("core", false),
      makeTool("ext_a", true),
      makeTool("ext_b", true),
      makeTool("ext_c", true),
    ];
    const perTool = estimateToolDefTokens({
      name: "ext_a",
      description: tools[1]!.description,
      parameters: tools[1]!.parameters as never,
    });
    // Room for core + one external at a time.
    const budget = 40 + perTool + Math.floor(perTool / 2);
    const { adapter, shipped } = recordingAdapter("ext_c");
    const result = await runTurn(adapter, tools, { toolDefTokenBudget: budget });

    // First turn: over budget ⇒ at least one external collapsed.
    expect(shipped[0]!.some((def) => def.description.includes(COLLAPSED_TOOL_HINT))).toBe(true);
    // Second turn: ext_c was just called, so it is MRU and keeps its full schema.
    const secondExtC = shipped[1]!.find((def) => def.name === "ext_c")!;
    expect(secondExtC.description.includes(COLLAPSED_TOOL_HINT)).toBe(false);
    // The MRU is returned for the caller to persist.
    expect(result.recentlyUsedTools[0]).toBe("ext_c");
  });
});
