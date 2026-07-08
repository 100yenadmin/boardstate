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
