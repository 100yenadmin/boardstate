import { describe, expect, it, vi } from "vitest";
import type { Transport } from "@boardstate/core";
import { loadHistoryList, loadHistorySnapshot } from "./history.js";

function transportWith(request: Transport["request"]): Transport {
  return { request, addEventListener: vi.fn(() => () => {}) } as unknown as Transport;
}

describe("history RPC loaders", () => {
  it("loadHistoryList maps ring metadata and drops malformed entries", async () => {
    const request = vi.fn(async () => ({
      entries: [
        { version: 3, savedAt: "2026-07-08T00:00:00.000Z", bytes: 120 },
        { version: 0, savedAt: "", bytes: 0 },
        { nonsense: true },
      ],
    }));
    const list = await loadHistoryList(transportWith(request as never));
    expect(list).toEqual([{ version: 3, savedAt: "2026-07-08T00:00:00.000Z", bytes: 120 }]);
    expect(request).toHaveBeenCalledWith("dashboard.workspace.history.list", {});
  });

  it("returns an empty list when disconnected", async () => {
    expect(await loadHistoryList(null)).toEqual([]);
  });

  it("loadHistorySnapshot normalizes the returned doc", async () => {
    const request = vi.fn(async () => ({
      doc: {
        schemaVersion: 1,
        workspaceVersion: 5,
        tabs: [{ slug: "main", title: "Main", hidden: false, widgets: [] }],
        prefs: { tabOrder: ["main"] },
        widgetsRegistry: {},
      },
    }));
    const snapshot = await loadHistorySnapshot(transportWith(request as never), 5);
    expect(snapshot?.workspaceVersion).toBe(5);
    expect(request).toHaveBeenCalledWith("dashboard.workspace.history.get", { version: 5 });
  });
});
