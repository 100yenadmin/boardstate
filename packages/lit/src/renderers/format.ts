// Small presentation formatters for the builtin widgets. The source pulled these
// from an app-wide format util that is not part of this project, so they are
// re-implemented here minimally (locale-aware where it helps, dependency free).

/** Format a cost as USD, e.g. `3.2` → `$3.20`. */
export function formatCost(cost: number): string {
  const value = Number.isFinite(cost) ? cost : 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

/** Format a token count compactly, e.g. `1234567` → `1.2M`. */
export function formatTokens(tokens: number): string {
  const value = Number.isFinite(tokens) ? tokens : 0;
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

/** Format an epoch-ms timestamp as a short local date/time. */
export function formatDateTimeMs(ms: number): string {
  if (!Number.isFinite(ms)) {
    return "";
  }
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

/** Format a duration in ms as a compact human string, e.g. `90000` → `1m 30s`. */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "";
  }
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

/** Truncate `text` to `max` chars, appending an ellipsis when clipped. */
export function clampText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
