// Multi-agent provenance render-model (SPEC §13 provenance + §17.3, #59). When a board
// carries widgets from ≥2 distinct agent actors, each widget header gets a compact,
// deterministically-coloured chip (short id, full actor on hover) and the toolbar offers a
// filter that highlights one agent's widgets. This module is PURE (no DOM, no lit) so the
// render-model is unit-testable in isolation; the view + cell consume it.

import { dashboardAgentProvenance, type DashboardWorkspace } from "@boardstate/core";

/** The chip model for one widget's agent author. `dimmed` is set by the active filter. */
export type AgentChipModel = {
  /** Full actor string, e.g. `agent:alice` — shown as the chip's `title` (hover). */
  actor: string;
  /** The bare agent id (`alice`) — the provenance segment after `agent:`. */
  agentId: string;
  /** A short, header-safe label (the agent id, capped) — the chip's visible text. */
  short: string;
  /** Deterministic hue 0–359 derived from the actor; stable across renders + reloads. */
  hue: number;
  /** True when a filter is active and this chip's agent is NOT the highlighted one. */
  dimmed: boolean;
};

const SHORT_ID_MAX = 10;

/**
 * A stable 32-bit FNV-1a hash of a string → a hue in [0, 360). Deterministic and
 * reload-stable (no `Math.random`, no insertion order), so an agent keeps one colour
 * everywhere it appears. Not cryptographic — only a spread for visual distinction.
 */
export function agentHue(actor: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < actor.length; i++) {
    hash ^= actor.charCodeAt(i);
    // FNV prime multiply, kept in 32-bit unsigned space via Math.imul.
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 360;
}

/** Cap an agent id to a header-safe length, ellipsizing when it overflows. */
export function shortAgentId(agentId: string): string {
  return agentId.length <= SHORT_ID_MAX ? agentId : `${agentId.slice(0, SHORT_ID_MAX - 1)}…`;
}

/**
 * The distinct agent actors that authored a widget anywhere on the board, in stable
 * (sorted) order. `user`/`system`-authored and unstamped widgets contribute nothing —
 * only `agent:<id>` provenance counts, since scoping + chips are per-AGENT.
 */
export function distinctAgentActors(workspace: DashboardWorkspace): string[] {
  const actors = new Set<string>();
  for (const tab of workspace.tabs) {
    for (const widget of tab.widgets) {
      const actor = widget.createdBy;
      if (actor && dashboardAgentProvenance(actor)) {
        actors.add(actor);
      }
    }
  }
  return [...actors].sort();
}

/**
 * Whether the board is a MULTI-AGENT workspace: ≥2 distinct agent actors authored its
 * widgets. Below that threshold the chips + filter stay hidden (a single-agent or
 * operator-only board reads exactly as before — provenance is not noise until it
 * distinguishes something).
 */
export function isMultiAgentBoard(workspace: DashboardWorkspace): boolean {
  return distinctAgentActors(workspace).length >= 2;
}

/**
 * Build the chip model for a widget's `createdBy`, or `null` when there is no agent chip
 * to show (the widget is not agent-authored). `highlightedAgent` (the active filter, or
 * null) drives `dimmed`.
 */
export function agentChipFor(
  actor: string,
  highlightedAgent: string | null,
): AgentChipModel | null {
  const agentId = dashboardAgentProvenance(actor);
  if (!agentId) {
    return null;
  }
  return {
    actor,
    agentId,
    short: shortAgentId(agentId),
    hue: agentHue(actor),
    dimmed: highlightedAgent !== null && actor !== highlightedAgent,
  };
}
