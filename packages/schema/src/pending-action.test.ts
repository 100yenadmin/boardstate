// The pending-action record is the shape the M5b-3 engine (#41) persists for a
// server-enforced side-effecting tool call. This module owns the TYPE + shape guard
// only; these tables pin what `validatePendingAction` accepts and rejects.

import { describe, expect, it } from "vitest";
import { DATA_READ_RPC_ALLOWLIST } from "./binding-contract.js";
import { validatePendingAction } from "./schema.js";

function valid() {
  return {
    id: "act_01",
    connector: "officecli",
    tool: "send_mail",
    args: { to: "ops@x.io", subject: "hi" },
    requestedBy: "agent:main",
    createdAt: "2026-07-10T12:00:00.000Z",
    expiresAt: "2026-07-10T12:05:00.000Z",
    status: "pending",
  };
}

describe("validatePendingAction", () => {
  it("accepts a well-formed pending action and echoes it", () => {
    expect(validatePendingAction(valid())).toEqual(valid());
  });

  it("accepts each lifecycle status", () => {
    for (const status of ["pending", "confirmed", "denied", "expired"]) {
      expect(() => validatePendingAction({ ...valid(), status })).not.toThrow();
    }
  });

  it("treats requestedBy as optional", () => {
    const { requestedBy, ...rest } = valid();
    void requestedBy;
    expect(validatePendingAction(rest).requestedBy).toBeUndefined();
  });

  it("rejects an invalid status", () => {
    expect(() => validatePendingAction({ ...valid(), status: "approved" })).toThrow(
      "status must be pending, confirmed, denied, or expired",
    );
  });

  it("rejects a missing args object", () => {
    const { args, ...rest } = valid();
    void args;
    expect(() => validatePendingAction(rest)).toThrow("args is required");
  });

  it("rejects a non-object args", () => {
    expect(() => validatePendingAction({ ...valid(), args: "x" })).toThrow(
      "args must be an object",
    );
  });

  it("rejects an invalid connector name", () => {
    expect(() => validatePendingAction({ ...valid(), connector: "bad name" })).toThrow(
      "connector is invalid",
    );
  });

  it("rejects a non-ISO timestamp", () => {
    expect(() => validatePendingAction({ ...valid(), expiresAt: "soon" })).toThrow(
      "expiresAt must be an ISO 8601 timestamp",
    );
  });

  it("rejects an unknown key", () => {
    expect(() => validatePendingAction({ ...valid(), retries: 3 })).toThrow(
      "retries is not allowed",
    );
  });
});

describe("broker read allowlist (SPEC §18)", () => {
  it("exposes dashboard.connector.list as a first-party read", () => {
    expect(DATA_READ_RPC_ALLOWLIST).toContain("dashboard.connector.list");
  });
});
