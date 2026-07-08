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
