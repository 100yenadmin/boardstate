// Namespacing has two jobs: keep both name forms inside the 64-char budget, and never
// let two tools collapse onto one provider-safe name.

import { describe, expect, it } from "vitest";
import { BrokerBudgetError, BrokerNameCollisionError } from "./errors.js";
import {
  buildProviderNameMap,
  manifestId,
  parseManifestId,
  PROVIDER_NAME_PATTERN,
  toProviderName,
} from "./names.js";

describe("manifest ids + provider names", () => {
  it("builds and parses connector:tool ids", () => {
    const id = manifestId("office", "list_files");
    expect(id).toBe("office:list_files");
    expect(parseManifestId(id)).toEqual({ connector: "office", tool: "list_files" });
  });

  it("splits on the FIRST colon (tool names may be plain, connector never has one)", () => {
    expect(parseManifestId("office:weird:tool")).toEqual({
      connector: "office",
      tool: "weird:tool",
    });
  });

  it("enforces the 64-char budget on the manifest id", () => {
    const longTool = "t".repeat(70);
    expect(() => manifestId("office", longTool)).toThrow(BrokerBudgetError);
  });

  it("sanitizes into the provider charset and stays legal", () => {
    const name = toProviderName("slack.io", "send-message");
    expect(name).toBe("slack_io__send-message");
    expect(PROVIDER_NAME_PATTERN.test(name)).toBe(true);
  });

  it("enforces the 64-char budget on the provider name", () => {
    expect(() => toProviderName("c".repeat(40), "t".repeat(40))).toThrow(BrokerBudgetError);
  });

  it("maps ids to provider names and back", () => {
    const { idToProvider, providerToId } = buildProviderNameMap([
      "office:list_files",
      "slack:send",
    ]);
    expect(idToProvider.get("office:list_files")).toBe("office__list_files");
    expect(providerToId.get("office__list_files")).toBe("office:list_files");
    expect(providerToId.get("slack__send")).toBe("slack:send");
  });

  it("fails loud when two ids collapse onto one provider name", () => {
    // `x.y` and `x_y` both sanitize to `x_y` (`.` and `_` are out-of-charset → `_`).
    expect(() => buildProviderNameMap(["x.y:send", "x_y:send"])).toThrow(BrokerNameCollisionError);
  });
});
