// Render-model coverage for the multi-agent provenance chips (SPEC §17.3, #59): the pure
// helpers the view + cell consume. No DOM here — the view integration is exercised in
// boardstate-view.test.ts.

import { describe, expect, it } from "vitest";
import type { DashboardWorkspace } from "@boardstate/core";
import {
  agentChipFor,
  agentHue,
  distinctAgentActors,
  isMultiAgentBoard,
  shortAgentId,
} from "./agent-provenance.js";

function board(...createdBy: (string | undefined)[]): DashboardWorkspace {
  return {
    schemaVersion: 1,
    workspaceVersion: 1,
    capabilitiesRegistry: {},
    prefs: { tabOrder: ["t"] },
    tabs: [
      {
        slug: "t",
        title: "T",
        hidden: false,
        widgets: createdBy.map((actor, i) => ({
          id: `w${i}`,
          kind: "builtin:markdown",
          title: "W",
          grid: { x: 0, y: 0, w: 1, h: 1 },
          collapsed: false,
          ...(actor ? { createdBy: actor } : {}),
        })),
      },
    ],
  } as unknown as DashboardWorkspace;
}

describe("agentHue", () => {
  it("is deterministic and in [0, 360)", () => {
    const a = agentHue("agent:alice");
    expect(a).toBe(agentHue("agent:alice"));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(360);
  });

  it("spreads distinct actors to (usually) distinct hues", () => {
    expect(agentHue("agent:alice")).not.toBe(agentHue("agent:bob"));
  });
});

describe("shortAgentId", () => {
  it("passes through short ids and ellipsizes long ones", () => {
    expect(shortAgentId("alice")).toBe("alice");
    expect(shortAgentId("a-very-long-agent-identifier")).toHaveLength(10);
    expect(shortAgentId("a-very-long-agent-identifier").endsWith("…")).toBe(true);
  });
});

describe("distinctAgentActors + isMultiAgentBoard", () => {
  it("counts only distinct agent actors, ignoring user/system/unstamped", () => {
    const ws = board("agent:alice", "agent:bob", "agent:alice", "user", "system", undefined);
    expect(distinctAgentActors(ws)).toEqual(["agent:alice", "agent:bob"]);
    expect(isMultiAgentBoard(ws)).toBe(true);
  });

  it("is NOT multi-agent with a single agent (chips stay hidden)", () => {
    const ws = board("agent:alice", "agent:alice", "user");
    expect(isMultiAgentBoard(ws)).toBe(false);
  });
});

describe("agentChipFor", () => {
  it("returns null for a non-agent author", () => {
    expect(agentChipFor("user", null)).toBeNull();
    expect(agentChipFor("system", null)).toBeNull();
  });

  it("builds a chip and marks it dimmed only when another agent is highlighted", () => {
    const chip = agentChipFor("agent:alice", "agent:bob");
    expect(chip).toMatchObject({ actor: "agent:alice", agentId: "alice", short: "alice" });
    expect(chip!.dimmed).toBe(true);
    expect(agentChipFor("agent:alice", "agent:alice")!.dimmed).toBe(false);
    expect(agentChipFor("agent:alice", null)!.dimmed).toBe(false);
  });
});
