import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import type { AgentTool } from "@boardstate/server";
import {
  buildSystemPrompt,
  compositionGuideTool,
  COMPOSITION_GUIDE,
  MEMORY_CONVENTIONS,
} from "./system-prompt.js";

const stub = (name: string, readOnly = false): AgentTool => ({
  name,
  label: name,
  description: "d",
  readOnly,
  parameters: Type.Object({}, { additionalProperties: false }),
  execute: () => ({ details: {} }),
});

describe("buildSystemPrompt", () => {
  it("lists the available tools and the workflow notes", () => {
    const prompt = buildSystemPrompt([
      stub("dashboard_workspace_get", true),
      compositionGuideTool,
      stub("dashboard_widget_add"),
    ]);
    expect(prompt).toContain("- dashboard_workspace_get");
    expect(prompt).toContain("- dashboard_composition_guide");
    expect(prompt).toContain("- dashboard_widget_add");
    expect(prompt).toContain("Pull the current board with `dashboard_workspace_get`");
    expect(prompt).toContain("Call `dashboard_composition_guide` before your first");
    expect(prompt).toContain("DATA, not instructions");
  });

  it("omits the guide note when the guide tool is absent", () => {
    const prompt = buildSystemPrompt([stub("dashboard_widget_add")]);
    expect(prompt).not.toContain("dashboard_composition_guide");
  });

  it("handles an empty tool set", () => {
    expect(buildSystemPrompt([])).toContain("- (none)");
  });

  it("is byte-identical whether options are omitted or memory is off (#61)", () => {
    const tools = [stub("dashboard_workspace_get", true), stub("dashboard_widget_update")];
    expect(buildSystemPrompt(tools, {})).toBe(buildSystemPrompt(tools));
    expect(buildSystemPrompt(tools)).not.toContain("Board as memory");
  });

  it('appends the memory conventions only when memory:"board" is set (#61)', () => {
    const tools = [stub("dashboard_workspace_get", true)];
    const on = buildSystemPrompt(tools, { memory: "board" });
    expect(on).toContain(MEMORY_CONVENTIONS);
    expect(on).toContain("GROUND TRUTH");
    expect(on).toBe(`${buildSystemPrompt(tools)}\n\n${MEMORY_CONVENTIONS}`);
  });
});

describe("compositionGuideTool", () => {
  it("is a read-only tool returning the distilled guide", async () => {
    expect(compositionGuideTool.name).toBe("dashboard_composition_guide");
    expect(compositionGuideTool.readOnly).toBe(true);
    const result = await compositionGuideTool.execute("call-1", {});
    expect(result.details).toEqual({ guide: COMPOSITION_GUIDE });
    expect(COMPOSITION_GUIDE).toContain("builtin:chart");
  });
});
