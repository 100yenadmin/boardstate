import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateWorkspaceDoc } from "@boardstate/schema";
import { buildProgram } from "./bin.js";

async function runBin(stateDir: string, argv: string[]): Promise<string> {
  const program = buildProgram(stateDir);
  program.exitOverride();
  program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await program.parseAsync(argv, { from: "user" });
  } finally {
    process.stdout.write = originalWrite;
  }
  return chunks.join("");
}

describe("boardstate bin: the advertised `tab add <name>` onboarding command", () => {
  it("creates a tab through the in-process host and persists it to the state dir", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "boardstate-bin-"));
    try {
      const output = await runBin(stateDir, ["tab", "add", "sales"]);
      expect(output).toContain("sales");

      const raw = await fs.readFile(path.join(stateDir, "dashboard", "workspace.json"), "utf8");
      const doc = validateWorkspaceDoc(JSON.parse(raw));
      expect(doc.tabs.map((tab) => tab.title)).toContain("sales");
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("also exposes the full `dashboard` command tree", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "boardstate-bin-"));
    try {
      await runBin(stateDir, ["tab", "add", "sales", "--slug", "sales"]);
      const tabsJson = JSON.parse(await runBin(stateDir, ["dashboard", "tabs", "list", "--json"]));
      expect(tabsJson.tabs.map((tab: { slug: string }) => tab.slug)).toContain("sales");
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });
});
