#!/usr/bin/env node
// The `boardstate` executable. Resolves a default local state dir ($BOARDSTATE_STATE_DIR
// else ~/.boardstate, created on demand), wires the full `dashboard` command tree via
// `registerDashboardCli`, and adds the top-level `tab add <name>` alias the empty-state
// onboarding string advertises (SPEC — dashboard.empty.onboardingCommand). The alias is
// no privileged path: it drives the same `dashboard.tab.create` control-plane method as
// `dashboard tabs create`, just with the title as a positional argument.

import { mkdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { BOARDSTATE_STATE_DIR_ENV } from "@boardstate/core/node";
import {
  registerDashboardCli,
  addClientOptions,
  clientFromOptions,
  type ClientOptions,
} from "./node.js";

/** The default local state dir: `$BOARDSTATE_STATE_DIR` else `~/.boardstate`. */
export function resolveStateDir(): string {
  const fromEnv = process.env[BOARDSTATE_STATE_DIR_ENV];
  if (fromEnv && fromEnv.trim()) {
    return fromEnv;
  }
  return path.join(os.homedir(), ".boardstate");
}

/**
 * Build the `boardstate` command tree over `stateDir`. Exported so tests can drive the
 * wiring in-process without spawning a child. Callers own `exitOverride`/output config.
 */
export function buildProgram(stateDir: string): Command {
  const program = new Command();
  program
    .name("boardstate")
    .description("Boardstate dashboard control-plane CLI")
    .showHelpAfterError();

  registerDashboardCli({ program, stateDir });

  // The onboarding string advertises `boardstate tab add <name>` — a top-level shortcut
  // for `dashboard tabs create --title <name>`. Same method, title as a positional arg.
  const tab = program.command("tab").description("Shortcut commands for dashboard tabs");
  addClientOptions(
    tab
      .command("add")
      .argument("<name>", "Tab title")
      .description("Create a dashboard tab (alias for `dashboard tabs create --title`)")
      .option("--slug <slug>", "Tab slug")
      .option("--json", "Print JSON", false),
  ).action(
    async (name: string, commandOptions: ClientOptions & { slug?: string; json?: boolean }) => {
      const result = await clientFromOptions(commandOptions, stateDir).request(
        "dashboard.tab.create",
        {
          title: name,
          ...(commandOptions.slug ? { slug: commandOptions.slug } : {}),
          actor: "user",
        },
      );
      if (commandOptions.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(`created tab "${name}"\n`);
      }
    },
  );

  return program;
}

async function main(): Promise<void> {
  const stateDir = resolveStateDir();
  mkdirSync(stateDir, { recursive: true });
  await buildProgram(stateDir).parseAsync(process.argv);
}

/** True only when this file is the process entry (not when imported by a test). */
function isMainEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainEntry()) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
