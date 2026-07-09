import { describe, expect, it } from "vitest";
import {
  backoffMs,
  classifyFetchError,
  DEFAULT_RETRY_POLICY,
  isRetryableStatus,
  parseRetryAfter,
} from "./errors.js";

describe("isRetryableStatus", () => {
  it("treats 429 and 5xx as retryable, other 4xx as not", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
  });
});

describe("classifyFetchError", () => {
  it("marks network/timeout classes retryable", () => {
    expect(classifyFetchError(new TypeError("fetch failed")).retryable).toBe(true);
    expect(classifyFetchError(new Error("network timeout")).retryable).toBe(true);
    expect(classifyFetchError(new Error("ECONNRESET")).retryable).toBe(true);
  });

  it("marks other errors non-retryable", () => {
    expect(classifyFetchError(new Error("parse blew up")).retryable).toBe(false);
  });
});

describe("parseRetryAfter", () => {
  it("parses delta-seconds", () => {
    expect(parseRetryAfter("2")).toBe(2000);
    expect(parseRetryAfter("0")).toBe(0);
  });
  it("returns undefined for missing/garbage", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter("not-a-date")).toBeUndefined();
  });
});

describe("backoffMs", () => {
  it("honors an explicit Retry-After over the exponential curve", () => {
    expect(backoffMs(0, DEFAULT_RETRY_POLICY, 1234)).toBe(1234);
  });
  it("grows exponentially and stays within the cap", () => {
    const policy = { maxAttempts: 4, baseMs: 500, maxMs: 30_000 };
    const a0 = backoffMs(0, policy);
    const a3 = backoffMs(3, policy);
    expect(a0).toBeGreaterThanOrEqual(500);
    expect(a0).toBeLessThan(1100);
    expect(a3).toBeGreaterThanOrEqual(4000);
    expect(a3).toBeLessThanOrEqual(30_000);
  });
});
