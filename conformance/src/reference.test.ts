// The reference run: `runTransportConformance` against the in-process reference
// host (`createInProcessHost` from @boardstate/server over `MemoryStorageAdapter`
// + `DashboardStore` from @boardstate/core). This is the proof that the suite and
// the reference implementation agree — the reference host IS conformant.
//
// It also carries a node-side proof of the one contract the host-agnostic suite
// cannot exercise: `file`-binding resolution reads the host's real on-disk data
// dir (not the storage adapter), so seeding a data file is inherently host
// specific. That proof ports the exact shipped P1 verbatim — the client sends the
// whole binding under `{ binding }` and the server applies the JSON pointer.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DashboardStore, MemoryStorageAdapter, type Transport } from "@boardstate/core";
import {
  createInProcessHost,
  nodeRpcDeps,
  registerBoardstateRpc,
  type RequestContext,
} from "@boardstate/server/node";
import { runTransportConformance } from "./suite.js";

/** A fresh reference host; `dataRead` points at an isolated real temp dir. */
async function makeReferenceHost(): Promise<{
  host: ReturnType<typeof createInProcessHost>;
  dataDir: string;
}> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "boardstate-conformance-"));
  const storage = new MemoryStorageAdapter();
  const store = new DashboardStore({ storage });
  const host = createInProcessHost(store, storage);
  registerBoardstateRpc(host, { store, dataRead: { stateDir: dataDir }, ...nodeRpcDeps() });
  return { host, dataDir };
}

runTransportConformance(
  async () => {
    const { host, dataDir } = await makeReferenceHost();
    return {
      transport: host as Transport,
      teardown: async () => {
        await fs.rm(dataDir, { recursive: true, force: true });
      },
    };
  },
  {
    extensions: { widgetState: true, history: true },
    // Three operator-scoped transports over one shared reference host: operator
    // identity is threaded via the InProcessHost `request(method, params, ctx)`
    // third argument (fail-closed to null for the unidentified caller).
    operators: async () => {
      const storage = new MemoryStorageAdapter();
      const store = new DashboardStore({ storage });
      const host = createInProcessHost(store, storage);
      registerBoardstateRpc(host, { store, ...nodeRpcDeps() });
      const scoped = (operatorId: string | null): Transport => ({
        request: (method, params) => host.request(method, params, { operatorId } as RequestContext),
        addEventListener: (event, fn) => host.addEventListener(event, fn),
      });
      return {
        a: scoped("op-A"),
        b: scoped("op-B"),
        unidentified: scoped(null),
        teardown: async () => {},
      };
    },
  },
);

describe("reference file-binding resolution (node fs)", () => {
  it("resolves a file binding + server-side JSON pointer via dashboard.data.read", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "boardstate-databind-"));
    try {
      const dashDataDir = path.join(dataDir, "dashboard", "data");
      await fs.mkdir(dashDataDir, { recursive: true });
      await fs.writeFile(
        path.join(dashDataDir, "metrics.json"),
        JSON.stringify({ metrics: { revenue: 42 } }),
        "utf8",
      );
      const storage = new MemoryStorageAdapter();
      const store = new DashboardStore({ storage });
      const host = createInProcessHost(store, storage);
      registerBoardstateRpc(host, { store, dataRead: { stateDir: dataDir }, ...nodeRpcDeps() });

      // The whole binding flows under `{ binding }`; the server applies the pointer.
      const resolved = (await host.request("dashboard.data.read", {
        binding: { source: "file", path: "metrics.json", pointer: "/metrics/revenue" },
      })) as { data: unknown };
      expect(resolved.data).toBe(42);

      // A missing file is server-resolved (routed to the file resolver), not
      // rejected as client-resolved — proving `{ source: "file" }` is the host's.
      await expect(
        host.request("dashboard.data.read", {
          binding: { source: "file", path: "absent.json" },
        }),
      ).rejects.toThrow();
    } finally {
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });
});
