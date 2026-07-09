// Honest retry classification + backoff policy (SPEC §14.4, ROADMAP M2 loop policy).
// Retryable = transient only: HTTP 429, any 5xx, and network/timeout failures. Everything
// else (4xx other than 429, JSON errors, refusals) is a hard failure and is NOT retried.

export type RetryPolicy = {
  /** Total attempts including the first (ROADMAP: max 4). */
  maxAttempts: number;
  /** Base backoff in ms (ROADMAP: 500). */
  baseMs: number;
  /** Backoff ceiling in ms (ROADMAP: 30_000). */
  maxMs: number;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxAttempts: 4, baseMs: 500, maxMs: 30_000 };

/** A transport failure classification (before it becomes a `ProviderDelta` / event). */
export type FailureInfo = { code: string; message: string; retryable: boolean };

/** 429 and 5xx are transient; every other status is a hard failure. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Classify a thrown fetch error. Network/timeout classes (`TypeError` from `fetch`,
 * `fetch failed`, `ECONN*`/`ETIMEDOUT`, "network"/"timeout") are retryable; a caller
 * that already knows the signal aborted must special-case abort BEFORE calling this.
 */
export function classifyFetchError(error: unknown): FailureInfo {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  const retryable =
    name === "TypeError" ||
    /network|timeout|fetch failed|econn|etimedout|socket|dns/i.test(message);
  return { code: name || "network_error", message, retryable };
}

/** Parse a `Retry-After` header (delta-seconds or an HTTP date) into ms from now. */
export function parseRetryAfter(headerValue: string | null | undefined): number | undefined {
  if (!headerValue) {
    return undefined;
  }
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(headerValue);
  if (Number.isFinite(date)) {
    return Math.max(0, date - Date.now());
  }
  return undefined;
}

/**
 * Backoff for a 0-based attempt: exponential (`base * 2^attempt`, capped) with full
 * jitter, unless the provider gave an explicit `Retry-After` — which wins outright.
 */
export function backoffMs(attempt: number, policy: RetryPolicy, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && retryAfterMs >= 0) {
    return Math.min(policy.maxMs, retryAfterMs);
  }
  const expo = Math.min(policy.maxMs, policy.baseMs * 2 ** attempt);
  const jitter = Math.random() * policy.baseMs;
  return Math.min(policy.maxMs, expo + jitter);
}
