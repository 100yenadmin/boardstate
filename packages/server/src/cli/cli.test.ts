import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { registerDashboardCli } from "./index.js";
import { parseDashboardBindingShorthand, parseDashboardGrid } from "./parsers.js";

describe("cli parsers", () => {
  it("parses a grid shorthand", () => {
    expect(parseDashboardGrid("1,2,3,4")).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(() => parseDashboardGrid("1,2,3")).toThrow("grid must be x,y,w,h");
  });

  it("parses file/rpc/static binding shorthands", () => {
    expect(parseDashboardBindingShorthand("v=file:reports/q1.json#/total")).toEqual([
      "v",
      { source: "file", path: "reports/q1.json", pointer: "/total" },
    ]);
    expect(parseDashboardBindingShorthand("v=rpc:sessions.list")).toEqual([
      "v",
      { source: "rpc", method: "sessions.list" },
    ]);
    expect(parseDashboardBindingShorthand('v=static:{"ok":true}')).toEqual([
      "v",
      { source: "static", value: { ok: true } },
    ]);
    expect(() => parseDashboardBindingShorthand("bad")).toThrow(/binding must be/);
  });
});

async function runCli(stateDir: string, argv: string[]): Promise<string> {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
  registerDashboardCli({ program, stateDir });
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await program.parseAsync(["dashboard", ...argv], { from: "user" });
  } finally {
    process.stdout.write = originalWrite;
  }
  return chunks.join("");
}

describe("dashboard cli round-trips over an in-process host", () => {
  it("creates a tab, adds a widget, and lists them from the same state dir", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "boardstate-cli-"));
    try {
      await runCli(stateDir, ["tabs", "create", "--title", "Reports", "--slug", "reports"]);
      await runCli(stateDir, [
        "widgets",
        "add",
        "--tab",
        "reports",
        "--kind",
        "builtin:markdown",
        "--id",
        "summary",
        "--grid",
        "0,0,6,3",
      ]);

      const tabsJson = JSON.parse(await runCli(stateDir, ["tabs", "list", "--json"]));
      expect(tabsJson.tabs.map((tab: { slug: string }) => tab.slug)).toContain("reports");

      const widgetsJson = JSON.parse(
        await runCli(stateDir, ["widgets", "list", "--tab", "reports", "--json"]),
      );
      expect(widgetsJson.widgets).toEqual([
        expect.objectContaining({ tab: "reports", id: "summary", kind: "builtin:markdown" }),
      ]);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });
});
