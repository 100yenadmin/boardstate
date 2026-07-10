// The node-only dashboard tool set: the browser-safe core tools plus widget
// scaffolding (writes the bundle to the state dir) and file-binding data reads,
// with the FsStorageAdapter default a CLI/MCP host expects. Exported from
// `@boardstate/server/node`; browser hosts use `createDashboardCoreTools` from the
// root entry instead.

import { DashboardStore, type ResolveBindingOptions } from "@boardstate/core";
import { FsStorageAdapter, resolveBinding } from "@boardstate/core/node";
import { Type } from "typebox";
import { toolJson, type AgentTool, type ToolContext } from "./host.js";
import { scaffoldDashboardWidget } from "./scaffold.js";
import {
  actorFromContext,
  broadcastChange,
  createDashboardCoreTools,
  readRecord,
  readOptionalString,
  readRequiredString,
  toolDescription,
  BindingSchema,
  type DashboardBroadcast,
  type ToolSearchCapability,
} from "./tools.js";

export type DashboardToolParams = {
  context?: ToolContext;
  store?: DashboardStore;
  broadcast?: DashboardBroadcast;
  dataRead?: ResolveBindingOptions;
  /** Backs `boardstate_tool_search` (M5c-2); wire from `createBrokerToolSearch` when a broker is present. */
  toolSearch?: ToolSearchCapability;
};

export function createDashboardTools(params: DashboardToolParams): AgentTool[] {
  const store = params.store ?? new DashboardStore({ storage: new FsStorageAdapter() });
  const actor = actorFromContext(params.context);
  const broadcast = params.broadcast;
  return [
    ...createDashboardCoreTools({
      context: params.context,
      store,
      broadcast,
      ...(params.toolSearch ? { toolSearch: params.toolSearch } : {}),
    }),
    {
      name: "dashboard_widget_scaffold",
      label: "Dashboard Widget Scaffold",
      readOnly: false,
      description: toolDescription(
        "Create a custom widget scaffold. Agent-authored scaffolds enter the registry as pending.",
      ),
      parameters: Type.Object(
        {
          name: Type.String({ description: "Custom widget name, A-Z a-z 0-9 . _ - only." }),
          title: Type.Optional(Type.String({ description: "Widget display title." })),
        },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, rawParams) => {
        const record = readRecord(rawParams, ["name", "title"]);
        const scaffold = await scaffoldDashboardWidget({
          name: readRequiredString(record, "name", "name"),
          title: readOptionalString(record, "title"),
          stateDir: store.stateDir,
          createdBy: actor,
        });
        const result = await store.mutate(
          (draft) => {
            draft.widgetsRegistry[scaffold.name] = {
              status: "pending",
              createdBy: actor,
            };
          },
          { actor },
        );
        broadcastChange(broadcast, { doc: result.doc, actor });
        return toolJson({
          ...scaffold,
          registry: result.doc.widgetsRegistry[scaffold.name],
          workspaceVersion: result.doc.workspaceVersion,
        });
      },
    },
    {
      name: "dashboard_data_read",
      label: "Dashboard Data Read",
      readOnly: true,
      description:
        "Resolve a dashboard binding exactly as a widget sees it. RPC bindings return binding_client_resolved.",
      parameters: Type.Object({ binding: BindingSchema }, { additionalProperties: false }),
      execute: async (_toolCallId, rawParams) => {
        const record = readRecord(rawParams, ["binding"]);
        return toolJson({ data: await resolveBinding(record.binding, params.dataRead) });
      },
    },
  ];
}
