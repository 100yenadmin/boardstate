import path from "node:path";
import { describe, expect, it } from "vitest";
import { DashboardStore } from "../store.js";
import { MemoryStorageAdapter } from "./storage-memory.js";

describe("MemoryStorageAdapter", () => {
  it("round-trips files and lists a directory's immediate children", async () => {
    const adapter = new MemoryStorageAdapter({ storageDir: "/mem" });
    expect(await adapter.readFile("/mem/a.json")).toBeNull();
    await adapter.writeFileAtomic("/mem/a.json", "a");
    await adapter.writeFileAtomic(path.join("/mem", "sub", "b.json"), "b");
    expect(await adapter.readFile("/mem/a.json")).toBe("a");
    expect((await adapter.readdir("/mem")).toSorted()).toEqual(["a.json", "sub"]);
    await adapter.rm("/mem/sub");
    expect(await adapter.readFile(path.join("/mem", "sub", "b.json"))).toBeNull();
  });

  it("backs a full store round-trip without touching the filesystem", async () => {
    const store = new DashboardStore({ storage: new MemoryStorageAdapter({ storageDir: "/mem" }) });
    const seeded = await store.read();
    expect(seeded.workspaceVersion).toBe(1);
    const mutated = await store.mutate(
      (draft) => {
        draft.tabs[0]!.title = "Renamed";
      },
      { actor: "user" },
    );
    expect(mutated.doc.tabs[0]!.title).toBe("Renamed");
    expect((await store.read()).tabs[0]!.title).toBe("Renamed");
    const restored = await store.undo();
    expect(restored.tabs[0]!.title).toBe("Overview");
  });
});
