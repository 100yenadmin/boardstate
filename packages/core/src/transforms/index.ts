// Pure data transforms for the builtin widget kinds: each `map*`/`evaluate*` turns
// a resolved binding value into a DOM-free view model. Host presentation packages
// render these; the transforms themselves carry no DOM or transport dependency.

export { isRecord, toFiniteNumber, widgetProps } from "./types.js";
export { mapStatCard, type StatCardModel } from "./stat-card.js";
export { mapMarkdownSource } from "./markdown.js";
export { mapTable, type TableModel } from "./table.js";
export { mapSessions, type SessionsModel, type SessionsRowModel } from "./sessions.js";
export { mapUsage, type UsageModel } from "./usage.js";
export { mapCron, type CronJobModel, type CronModel } from "./cron.js";
export { mapInstances, type InstanceModel, type InstancesModel } from "./instances.js";
export { mapActivity, type ActivityEntryModel, type ActivityModel } from "./activity.js";
export { evaluateEmbedUrl, type EmbedUrlDecision } from "./iframe-embed.js";
export { mapChart, normalizeSeries, type ChartType, type ChartModel } from "./chart.js";
export { notesTextFromState, NOTES_PERSIST_DEBOUNCE_MS } from "./notes.js";
export {
  mapActionForm,
  coerceFieldValue,
  buildActionFormPrompt,
  ACTION_FORM_DEFAULT_MAX_LENGTH,
  type ActionFormField,
  type ActionFormFieldType,
  type ActionFormModel,
} from "./action-form.js";
export { mapPreviewViewport, type PreviewViewport } from "./preview.js";
export { mapAgentStatus, type AgentStatusRowModel, type AgentStatusModel } from "./agent-status.js";
export {
  buildWidgetApprovalsSource,
  mapApprovals,
  toWidgetApprovalDecision,
  type ApprovalDecision,
  type PendingApprovalItem,
  type ApprovalsWidgetSource,
  type ApprovalsModel,
} from "./approvals.js";
