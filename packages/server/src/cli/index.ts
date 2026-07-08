// The `dashboard` CLI command tree (tabs / widgets / layout / widget-scaffold).
// Every command is a protocol client: it builds a `BoardstateClient` from its
// transport options and drives the same control-plane methods the UI and agent
// tools use. Human drag/drop parity is a protocol requirement, so the CLI has no
// privileged path — it validates and calls exactly like everyone else.

import fs from "node:fs/promises";
import type { Command } from "commander";
import {
  validateWorkspaceDoc,
  type DashboardTab,
  type DashboardWidget,
  type WorkspaceDoc,
} from "@boardstate/schema";
import { scaffoldDashboardWidget } from "../scaffold.js";
import {
  addClientOptions,
  clientFromOptions,
  type BoardstateClient,
  type ClientOptions,
} from "./client.js";
import {
  collectBinding,
  parseBindings,
  parseDashboardGrid,
  parseJson,
  parseOptionalBoolean,
} from "./parsers.js";

type JsonOptions = { json?: boolean };
type CommandOptions = ClientOptions & JsonOptions;

export type RegisterDashboardCliOptions = {
  program: Command;
  /** Default local state dir when no `--state-dir`/`--url` is passed. */
  stateDir?: string;
};

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function writeLine(value: string): void {
  process.stdout.write(`${value}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readWorkspaceResult(value: unknown): { doc: WorkspaceDoc; workspaceVersion: number } {
  if (!isRecord(value)) {
    throw new Error("dashboard response must be an object");
  }
  const doc = validateWorkspaceDoc(value.doc);
  return {
    doc,
    workspaceVersion:
      typeof value.workspaceVersion === "number" ? value.workspaceVersion : doc.workspaceVersion,
  };
}

async function readWorkspace(client: BoardstateClient): Promise<WorkspaceDoc> {
  return readWorkspaceResult(await client.request("dashboard.workspace.get")).doc;
}

function orderedTabs(doc: WorkspaceDoc): DashboardTab[] {
  const bySlug = new Map(doc.tabs.map((tab) => [tab.slug, tab]));
  const ordered = doc.prefs.tabOrder.flatMap((slug) => {
    const tab = bySlug.get(slug);
    return tab ? [tab] : [];
  });
  const seen = new Set(ordered.map((tab) => tab.slug));
  return [...ordered, ...doc.tabs.filter((tab) => !seen.has(tab.slug))];
}

function formatTabLine(tab: DashboardTab): string {
  const hidden = tab.hidden ? "hidden" : "visible";
  return `${tab.slug.padEnd(18)} ${hidden.padEnd(8)} ${tab.title}`;
}

function formatWidgetLine(tab: string, widget: DashboardWidget): string {
  const grid = `${widget.grid.x},${widget.grid.y},${widget.grid.w},${widget.grid.h}`;
  const state = [widget.hidden ? "hidden" : "visible", widget.collapsed ? "collapsed" : ""]
    .filter(Boolean)
    .join(",");
  return `${tab.padEnd(14)} ${widget.id.padEnd(18)} ${widget.kind.padEnd(20)} ${grid.padEnd(9)} ${state.padEnd(10)} ${widget.title ?? ""}`;
}

function writeTabs(doc: WorkspaceDoc, options: JsonOptions): void {
  const tabs = orderedTabs(doc);
  if (options.json) {
    writeJson({ tabs });
    return;
  }
  for (const tab of tabs) {
    writeLine(formatTabLine(tab));
  }
}

function widgetRows(
  doc: WorkspaceDoc,
  tabSlug?: string,
): Array<{ tab: string; widget: DashboardWidget }> {
  const tabs = tabSlug ? doc.tabs.filter((tab) => tab.slug === tabSlug) : orderedTabs(doc);
  if (tabSlug && tabs.length === 0) {
    throw new Error(`dashboard tab not found: ${tabSlug}`);
  }
  return tabs.flatMap((tab) => tab.widgets.map((widget) => ({ tab: tab.slug, widget })));
}

function writeWidgets(doc: WorkspaceDoc, options: JsonOptions & { tab?: string }): void {
  const widgets = widgetRows(doc, options.tab);
  if (options.json) {
    writeJson({ widgets: widgets.map(({ tab, widget }) => ({ tab, ...widget })) });
    return;
  }
  for (const { tab, widget } of widgets) {
    writeLine(formatWidgetLine(tab, widget));
  }
}

function requirePatch(patch: Record<string, unknown>): void {
  if (Object.keys(patch).length === 0) {
    throw new Error("at least one patch option is required");
  }
}

export function registerDashboardCli(options: RegisterDashboardCliOptions): void {
  const defaultStateDir = options.stateDir;
  const client = (commandOptions: ClientOptions): BoardstateClient =>
    clientFromOptions(commandOptions, defaultStateDir);

  const dashboard = options.program.command("dashboard").description("Manage dashboard workspaces");
  const tabs = dashboard.command("tabs").description("Manage dashboard tabs");
  const widgets = dashboard.command("widgets").description("Manage dashboard widgets");
  const layout = dashboard.command("layout").description("Manage dashboard layout documents");

  addClientOptions(
    tabs.command("list").description("List dashboard tabs").option("--json", "Print JSON", false),
  ).action(async (commandOptions: CommandOptions) => {
    writeTabs(await readWorkspace(client(commandOptions)), commandOptions);
  });

  addClientOptions(
    tabs
      .command("create")
      .description("Create a dashboard tab")
      .requiredOption("--title <title>", "Tab title")
      .option("--slug <slug>", "Tab slug")
      .option("--icon <icon>", "Icon name")
      .option("--json", "Print JSON", false),
  ).action(
    async (commandOptions: CommandOptions & { title: string; slug?: string; icon?: string }) => {
      const result = await client(commandOptions).request("dashboard.tab.create", {
        title: commandOptions.title,
        ...(commandOptions.slug ? { slug: commandOptions.slug } : {}),
        ...(commandOptions.icon ? { icon: commandOptions.icon } : {}),
        actor: "user",
      });
      writeTabs(readWorkspaceResult(result).doc, commandOptions);
    },
  );

  addClientOptions(
    tabs
      .command("delete")
      .argument("<slug>", "Tab slug")
      .description("Delete a dashboard tab")
      .option("--json", "Print JSON", false),
  ).action(async (slug: string, commandOptions: CommandOptions) => {
    const result = await client(commandOptions).request("dashboard.tab.delete", {
      slug,
      actor: "user",
    });
    writeTabs(readWorkspaceResult(result).doc, commandOptions);
  });

  addClientOptions(
    tabs
      .command("reorder")
      .argument("<slug...>", "Tab slugs")
      .description("Set dashboard tab order")
      .option("--json", "Print JSON", false),
  ).action(async (order: string[], commandOptions: CommandOptions) => {
    const result = await client(commandOptions).request("dashboard.tab.reorder", {
      order,
      actor: "user",
    });
    writeTabs(readWorkspaceResult(result).doc, commandOptions);
  });

  for (const [verb, hidden] of [
    ["hide", true],
    ["show", false],
  ] as const) {
    addClientOptions(
      tabs
        .command(verb)
        .argument("<slug>", "Tab slug")
        .description(`${verb} a dashboard tab`)
        .option("--json", "Print JSON", false),
    ).action(async (slug: string, commandOptions: CommandOptions) => {
      const result = await client(commandOptions).request("dashboard.tab.update", {
        slug,
        patch: { hidden },
        actor: "user",
      });
      writeTabs(readWorkspaceResult(result).doc, commandOptions);
    });
  }

  addClientOptions(
    widgets
      .command("list")
      .description("List dashboard widgets")
      .option("--tab <slug>", "Tab slug")
      .option("--json", "Print JSON", false),
  ).action(async (commandOptions: CommandOptions & { tab?: string }) => {
    writeWidgets(await readWorkspace(client(commandOptions)), commandOptions);
  });

  addClientOptions(
    widgets
      .command("add")
      .description("Add a dashboard widget")
      .requiredOption("--tab <slug>", "Tab slug")
      .requiredOption("--kind <kind>", "Widget kind")
      .option("--id <id>", "Widget id")
      .option("--title <title>", "Widget title")
      .option("--grid <x,y,w,h>", "Widget grid", "0,0,4,2")
      .option("--binding <id=source>", "Binding shorthand", collectBinding, [])
      .option("--props <json>", "Widget props JSON")
      .option("--json", "Print JSON", false),
  ).action(
    async (
      commandOptions: CommandOptions & {
        tab: string;
        id?: string;
        kind: string;
        title?: string;
        grid?: string;
        binding?: string[];
        props?: string;
      },
    ) => {
      const bindings = parseBindings(commandOptions.binding);
      const result = await client(commandOptions).request("dashboard.widget.add", {
        tab: commandOptions.tab,
        widget: {
          ...(commandOptions.id ? { id: commandOptions.id } : {}),
          kind: commandOptions.kind,
          ...(commandOptions.title ? { title: commandOptions.title } : {}),
          grid: parseDashboardGrid(commandOptions.grid ?? "0,0,4,2"),
          ...(bindings ? { bindings } : {}),
          ...(commandOptions.props ? { props: parseJson(commandOptions.props, "props") } : {}),
        },
        actor: "user",
      });
      writeWidgets(readWorkspaceResult(result).doc, { ...commandOptions, tab: commandOptions.tab });
    },
  );

  addClientOptions(
    widgets
      .command("update")
      .description("Update a dashboard widget")
      .requiredOption("--tab <slug>", "Tab slug")
      .requiredOption("--id <id>", "Widget id")
      .option("--title <title>", "Widget title")
      .option("--collapsed <bool>", "Collapsed state", parseOptionalBoolean)
      .option("--hidden <bool>", "Hidden state", parseOptionalBoolean)
      .option("--json", "Print JSON", false),
  ).action(
    async (
      commandOptions: CommandOptions & {
        tab: string;
        id: string;
        title?: string;
        collapsed?: boolean;
        hidden?: boolean;
      },
    ) => {
      const patch = {
        ...(commandOptions.title !== undefined ? { title: commandOptions.title } : {}),
        ...(commandOptions.collapsed !== undefined ? { collapsed: commandOptions.collapsed } : {}),
        ...(commandOptions.hidden !== undefined ? { hidden: commandOptions.hidden } : {}),
      };
      requirePatch(patch);
      const result = await client(commandOptions).request("dashboard.widget.update", {
        tab: commandOptions.tab,
        id: commandOptions.id,
        patch,
        actor: "user",
      });
      writeWidgets(readWorkspaceResult(result).doc, { ...commandOptions, tab: commandOptions.tab });
    },
  );

  addClientOptions(
    widgets
      .command("move")
      .description("Move a dashboard widget")
      .option("--tab <slug>", "Current tab slug")
      .requiredOption("--id <id>", "Widget id")
      .option("--grid <x,y,w,h>", "New grid")
      .option("--to-tab <slug>", "Destination tab slug")
      .option("--json", "Print JSON", false),
  ).action(
    async (
      commandOptions: CommandOptions & { tab?: string; id: string; grid?: string; toTab?: string },
    ) => {
      const result = await client(commandOptions).request("dashboard.widget.move", {
        ...(commandOptions.tab ? { tab: commandOptions.tab } : {}),
        id: commandOptions.id,
        ...(commandOptions.grid ? { grid: parseDashboardGrid(commandOptions.grid) } : {}),
        ...(commandOptions.toTab ? { toTab: commandOptions.toTab } : {}),
        actor: "user",
      });
      writeWidgets(readWorkspaceResult(result).doc, { ...commandOptions, tab: commandOptions.tab });
    },
  );

  addClientOptions(
    widgets
      .command("remove")
      .description("Remove a dashboard widget")
      .requiredOption("--tab <slug>", "Tab slug")
      .requiredOption("--id <id>", "Widget id")
      .option("--json", "Print JSON", false),
  ).action(async (commandOptions: CommandOptions & { tab: string; id: string }) => {
    const result = await client(commandOptions).request("dashboard.widget.remove", {
      tab: commandOptions.tab,
      id: commandOptions.id,
      actor: "user",
    });
    writeWidgets(readWorkspaceResult(result).doc, { ...commandOptions, tab: commandOptions.tab });
  });

  addClientOptions(
    layout
      .command("get")
      .description("Read dashboard workspace layout")
      .option("--json", "Print JSON", false),
  ).action(async (commandOptions: CommandOptions) => {
    const doc = await readWorkspace(client(commandOptions));
    if (commandOptions.json) {
      writeJson({ doc, workspaceVersion: doc.workspaceVersion });
    } else {
      writeLine(`workspaceVersion ${doc.workspaceVersion}`);
      writeTabs(doc, commandOptions);
    }
  });

  addClientOptions(
    layout
      .command("set")
      .description("Replace dashboard workspace layout")
      .requiredOption("--file <path>", "Workspace JSON file")
      .option("--json", "Print JSON", false),
  ).action(async (commandOptions: CommandOptions & { file: string }) => {
    const doc = validateWorkspaceDoc(JSON.parse(await fs.readFile(commandOptions.file, "utf8")));
    const result = await client(commandOptions).request("dashboard.workspace.replace", {
      doc,
      actor: "user",
    });
    const next = readWorkspaceResult(result);
    if (commandOptions.json) {
      writeJson(next);
    } else {
      writeLine(`workspaceVersion ${next.workspaceVersion}`);
    }
  });

  addClientOptions(
    layout
      .command("undo")
      .description("Restore the newest dashboard undo snapshot")
      .option("--json", "Print JSON", false),
  ).action(async (commandOptions: CommandOptions) => {
    const result = await client(commandOptions).request("dashboard.workspace.undo", {
      actor: "user",
    });
    const next = readWorkspaceResult(result);
    if (commandOptions.json) {
      writeJson(next);
    } else {
      writeLine(`workspaceVersion ${next.workspaceVersion}`);
    }
  });

  addClientOptions(
    dashboard
      .command("widget-scaffold")
      .argument("<name>", "Custom widget name")
      .description("Create a custom widget scaffold")
      .option("--title <title>", "Widget title")
      .option("--json", "Print JSON", false),
  ).action(async (name: string, commandOptions: CommandOptions & { title?: string }) => {
    const scaffold = await scaffoldDashboardWidget({
      name,
      title: commandOptions.title,
      stateDir: commandOptions.stateDir ?? defaultStateDir,
    });
    const activeClient = client(commandOptions);
    const doc = await readWorkspace(activeClient);
    doc.widgetsRegistry[scaffold.name] = {
      status: "approved",
      createdBy: "user",
      approvedBy: "user",
      approvedAt: new Date().toISOString(),
    };
    const result = await activeClient.request("dashboard.workspace.replace", {
      doc,
      actor: "user",
    });
    const next = readWorkspaceResult(result);
    if (commandOptions.json) {
      writeJson({ ...scaffold, registry: next.doc.widgetsRegistry[scaffold.name] });
    } else {
      writeLine(`created ${scaffold.dir}`);
    }
  });
}
