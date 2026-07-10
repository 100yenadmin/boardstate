// User-facing copy for the Boardstate reference view, injectable for i18n. The
// source view read strings from a host i18n `t()`; the package instead ships an
// English default table (`en`) and a `strings?` injection prop. Every renderer and
// view lookup goes through the module-level `t()` below, which resolves against the
// active table (defaults to `en`) and interpolates `{param}` placeholders.
//
// Keys are the original dotted identifiers so the mined set stays auditable against
// the source. `BoardstateStrings` is a partial override map — an embedder supplies
// only the keys it wants to change; unset keys fall back to `en`.

/** Full English string table. Its keys define the `BoardstateStrings` surface. */
export const en = {
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.reload": "Reload",
  "common.loading": "Loading…",
  "common.dismiss": "Dismiss",
  "dashboard.header.subtitle": "Your pinned widgets and workspaces.",
  "dashboard.tabs.label": "Workspaces",
  "dashboard.tabs.hidden": "Hidden ({count})",
  "dashboard.error.title": "Couldn’t load your workspace",
  "dashboard.error.subtitle": "Something went wrong reading the workspace document.",
  "dashboard.error.detailSummary": "Error detail",
  "dashboard.empty.onboardingTitle": "No workspaces yet",
  "dashboard.empty.onboardingSubtitle": "Ask the agent to add a workspace tab, or use the CLI.",
  "dashboard.empty.onboardingCommand": "boardstate tab add <name>",
  "dashboard.empty.noVisibleTabs": "All workspace tabs are hidden.",
  "dashboard.empty.tabTitle": "This workspace is empty",
  "dashboard.empty.tabSubtitle": "Ask the agent to add a widget here.",
  "dashboard.onboarding.title": "Add your first workspace",
  "dashboard.onboarding.primary": "Ask the agent to create a workspace tab for you.",
  "dashboard.onboarding.secondary": "Or add one from the CLI:",
  "dashboard.widget.editTitleTitle": "Edit widget title",
  "dashboard.widget.editTitleLabel": "Widget title",
  "dashboard.widget.moveToTabTitle": "Move widget to tab",
  "dashboard.widget.moveToTabEmpty": "There are no other tabs to move this widget to.",
  "dashboard.widget.menu.editTitle": "Edit title",
  "dashboard.widget.menu.moveToTab": "Move to tab",
  "dashboard.widget.menu.hide": "Hide",
  "dashboard.widget.menu.remove": "Remove",
  "dashboard.widget.provenanceChip": "AI",
  "dashboard.widget.provenanceTooltip": "Created by {agent}",
  "dashboard.widget.expand": "Expand widget",
  "dashboard.widget.collapse": "Collapse widget",
  "dashboard.widget.moveHandle": "Move widget",
  "dashboard.widget.resizeHandle": "Resize widget",
  "dashboard.widget.menuLabel": "Widget menu",
  "dashboard.widget.errorTitle": "This widget hit an error",
  "dashboard.widget.errorHumane": "The rest of your workspace is unaffected.",
  "dashboard.widget.errorDetailSummary": "Error detail",
  "dashboard.widget.customPlaceholder": "Custom widget",
  "dashboard.widget.customLoading": "Loading widget…",
  "dashboard.widget.unknownKind": "Unknown widget: {kind}",
  "dashboard.widget.approval.title": "Approve this widget?",
  "dashboard.widget.approval.byAgent": "Requested by {agent}",
  "dashboard.widget.approval.byUnknown": "Requested by an agent",
  "dashboard.widget.approval.approve": "Approve",
  "dashboard.widget.approval.reject": "Reject",
  "dashboard.widget.approval.unavailable": "This widget is unavailable.",
  "dashboard.widget.stat.empty": "—",
  "dashboard.widget.markdownEmpty": "Nothing to show yet.",
  "dashboard.widget.table.empty": "No rows to show.",
  "dashboard.widget.table.more": "+{count} more",
  "dashboard.widget.sessions.empty": "No sessions yet.",
  "dashboard.widget.usage.cost": "Cost",
  "dashboard.widget.usage.tokens": "Tokens",
  "dashboard.widget.cron.empty": "No scheduled jobs.",
  "dashboard.widget.cron.next": "Next {time}",
  "dashboard.widget.cron.noNext": "Not scheduled",
  "dashboard.widget.instances.empty": "No connected instances.",
  "dashboard.widget.instances.idle": "idle {duration}",
  "dashboard.widget.activity.empty": "No recent activity.",
  "dashboard.widget.embed.missing": "No URL configured for this embed.",
  "dashboard.widget.embed.blockedExternal": "External embeds are blocked by policy.",
  "dashboard.widget.embed.blockedScheme": "This URL scheme cannot be embedded.",
  "dashboard.widget.chart.empty": "No data to chart.",
  "dashboard.widget.chart.label": "Chart",
  "dashboard.widget.notes.placeholder": "Write a note…",
  "dashboard.widget.notes.readonlyHint": "Connect to the gateway to edit and save notes.",
  "dashboard.widget.actionForm.empty": "This action form has no fields yet.",
  "dashboard.widget.actionForm.submit": "Send",
  "dashboard.widget.preview.missing": "This preview has no URL yet.",
  "dashboard.widget.preview.blockedExternal":
    "External previews are disabled by your gateway policy.",
  "dashboard.widget.preview.blockedScheme": "This preview URL uses an unsupported scheme.",
  "dashboard.widget.preview.reload": "Reload preview",
  "dashboard.widget.preview.viewport.desktop": "Desktop",
  "dashboard.widget.preview.viewport.tablet": "Tablet",
  "dashboard.widget.preview.viewport.mobile": "Mobile",
  "dashboard.widget.agentStatus.empty": "No agents yet.",
  "dashboard.widget.agentStatus.busy": "Busy",
  "dashboard.widget.agentStatus.idle": "Idle",
  "dashboard.widget.agentStatus.progress": "{percent}% of budget",
  "dashboard.widget.approvals.empty": "No pending approvals.",
  "dashboard.widget.approvals.approve": "Approve",
  "dashboard.widget.approvals.deny": "Deny",
  "dashboard.widget.approvals.requestedBy": "Requested by {agent}",
  "dashboard.widget.approvals.kind.widget": "Widget",
  "dashboard.widget.approvals.kind.capability": "Data source",
  "dashboard.widget.chat.empty": "Ask the agent to build or change this board…",
  "dashboard.widget.chat.placeholder": "Message the agent…",
  "dashboard.widget.chat.send": "Send",
  "dashboard.widget.chat.stop": "Stop",
  "dashboard.widget.chat.disconnected": "Connect to the gateway to chat with the agent.",
  "dashboard.widget.chat.roleUser": "You",
  "dashboard.widget.chat.roleAssistant": "Agent",
  "dashboard.widget.chat.actionsOne": "1 action",
  "dashboard.widget.chat.actionsMany": "{count} actions",
  "dashboard.widget.chat.building": "building…",
  "dashboard.widget.chat.retrying": "retrying…",
  "dashboard.widget.chat.jumpToLatest": "Jump to latest",
  "dashboard.widget.chat.args": "Arguments",
  "dashboard.widget.chat.result": "Result",
  "dashboard.widget.chat.tool.readBoard": "Read the board",
  "dashboard.widget.chat.tool.createdTab": "Created tab {name}",
  "dashboard.widget.chat.tool.addedWidget": "Added widget {id}",
  "dashboard.widget.chat.approveTitle": "The agent scaffolded widget “{name}”",
  "dashboard.widget.chat.approve": "Approve",
  "dashboard.widget.chat.reject": "Reject",
  "common.close": "Close",
  "common.back": "Back",
  "dashboard.tabs.presence": "{count} viewing",
  "dashboard.tabs.private": "Private — only you can see this tab",
  "dashboard.tabs.groupUser": "You",
  "dashboard.tabs.groupSystem": "System",
  "dashboard.tabs.groupAgent": "{agent}",
  "dashboard.tabs.collapseGroup": "Collapse {group} tabs",
  "dashboard.tabs.expandGroup": "Expand {group} tabs",
  "dashboard.header.fullBleedEnter": "Full-bleed",
  "dashboard.header.fullBleedExit": "Exit full-bleed",
  "dashboard.widget.ephemeralBadge": "Temporary",
  "dashboard.widget.ephemeralTooltip": "Temporary answer — pin it to keep it here.",
  "dashboard.widget.menu.pin": "Pin",
  "dashboard.widget.blame.createdBy": "Created by {actor}",
  "dashboard.widget.blame.createdByVersion": "Created by {actor} · v{version}",
  "dashboard.widget.blame.logbookLink": "View in logbook",
  "dashboard.history.open": "History",
  "dashboard.history.title": "Workspace history",
  "dashboard.history.subtitle":
    "Review recent changes, compare against now, and undo the last one.",
  "dashboard.history.empty": "No history yet — changes appear here after your first edit.",
  "dashboard.history.emptyDetail": "Select a version to preview it.",
  "dashboard.history.version": "Version {version}",
  "dashboard.history.latest": "Latest change",
  "dashboard.history.previewTitle": "Snapshot",
  "dashboard.history.previewEmpty": "This tab had no widgets at this point.",
  "dashboard.history.diffTitle": "Changes since this version",
  "dashboard.history.diffEmpty": "Nothing changed since this version.",
  "dashboard.history.restore": "Undo last change",
  "dashboard.history.restoreConfirm": "Undo the most recent change?",
  "dashboard.history.restoreOnlyNewest": "Only the most recent change can be undone.",
  "dashboard.history.actorUnknown": "Unknown",
  "dashboard.history.kind.widget-added": "Added",
  "dashboard.history.kind.widget-removed": "Removed",
  "dashboard.history.kind.widget-moved": "Moved",
  "dashboard.history.kind.widget-retitled": "Retitled",
  "dashboard.history.kind.tab-added": "Tab added",
  "dashboard.history.kind.tab-removed": "Tab removed",
  "dashboard.history.kind.tab-retitled": "Tab retitled",
  "dashboard.gallery.open": "Widget gallery",
  "dashboard.gallery.title": "Widget gallery",
  "dashboard.gallery.subtitle": "Browse a widget registry and install a widget from its URL.",
  "dashboard.gallery.urlLabel": "Registry index URL",
  "dashboard.gallery.urlPlaceholder": "https://example.com/widgets/index.json",
  "dashboard.gallery.browse": "Browse",
  "dashboard.gallery.view": "View",
  "dashboard.gallery.install": "Install",
  "dashboard.gallery.empty": "No widgets found at this registry.",
  "dashboard.gallery.capabilities": "Requested capabilities",
  "dashboard.gallery.noCapabilities": "No special capabilities requested.",
  "dashboard.gallery.pendingNote":
    "Installed widgets stay pending until you approve them, then run sandboxed.",
  "dashboard.distribution.export": "Export",
  "dashboard.distribution.exportTitle": "Download this workspace as a JSON file",
  "dashboard.distribution.import": "Import",
  "dashboard.distribution.importTitle": "Import a workspace from a JSON file",
} satisfies Record<string, string>;

/** The set of overridable string keys. */
export type BoardstateStringKey = keyof typeof en;

/** Partial override map: unset keys fall back to the English default. */
export type BoardstateStrings = Partial<Record<BoardstateStringKey, string>>;

/** Interpolate `{name}` placeholders in `template` from `params`. */
function interpolate(template: string, params?: Record<string, string>): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(params, key) ? params[key]! : match,
  );
}

// The active table renderers and the view resolve against. Defaults to English;
// `<boardstate-view>` sets it from its `strings` prop before each render.
let activeStrings: Record<string, string> = { ...en };

/** Install a strings override (merged over the English defaults). */
export function setBoardstateStrings(strings: BoardstateStrings | undefined): void {
  activeStrings = strings ? { ...en, ...strings } : { ...en };
}

/** Resolve a string key against the active table, interpolating `{param}` values. */
export function t(key: BoardstateStringKey, params?: Record<string, string>): string {
  const template = activeStrings[key] ?? en[key] ?? key;
  return interpolate(template, params);
}
