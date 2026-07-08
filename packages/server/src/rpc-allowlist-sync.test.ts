// Drift guard for the read-method allowlist a `rpc` binding may name (SPEC §6).
//
// In the source plugin this test compared a browser-safe UI MIRROR against the
// server's canonical list, because the canonical module pulled in `node:path` and
// could not enter the browser bundle. In the boardstate monorepo the allowlist is
// consolidated into ONE dependency-light leaf — `@boardstate/schema`'s
// `DATA_READ_RPC_ALLOWLIST` — imported by every side (server data-read + manifest
// validator, and any future client), so there is no second copy to drift. This test
// pins the canonical contents so a silent widening/narrowing of the allowlist (a
// security-relevant change) still fails loudly, and asserts the manifest validator
// resolves the same list.

import { DATA_READ_RPC_ALLOWLIST, validateWidgetManifest } from "@boardstate/core";
import { describe, expect, it } from "vitest";

describe("rpc allowlist stays pinned to the canonical read-method set", () => {
  it("DATA_READ_RPC_ALLOWLIST matches the reference read-only method set (SPEC §6)", () => {
    expect([...DATA_READ_RPC_ALLOWLIST]).toEqual([
      "health",
      "system-presence",
      "usage.status",
      "usage.cost",
      "agents.list",
      "sessions.list",
      "sessions.resolve",
      "sessions.get",
      "sessions.usage",
      "sessions.usage.timeseries",
      "sessions.usage.logs",
      "node.list",
      "node.describe",
      "cron.get",
      "cron.list",
      "cron.status",
      "cron.runs",
    ]);
  });

  it("the manifest validator accepts only allowlisted rpc bindings (single source of truth)", () => {
    const base = {
      schemaVersion: 1 as const,
      name: "w",
      title: "W",
      entrypoint: "index.html",
      capabilities: [],
    };
    // An allowlisted method validates.
    expect(() =>
      validateWidgetManifest({
        ...base,
        bindings: [{ id: "a", source: "rpc", method: DATA_READ_RPC_ALLOWLIST[0] }],
      }),
    ).not.toThrow();
    // A non-allowlisted method is rejected at the same seam.
    expect(() =>
      validateWidgetManifest({
        ...base,
        bindings: [{ id: "a", source: "rpc", method: "secrets.exfiltrate" }],
      }),
    ).toThrow(/not allowlisted/);
  });
});
