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
  createChatSessions,
  createInProcessHost,
  nodeRpcDeps,
  registerBoardstateRpc,
  type ChatAgent,
  type InProcessHost,
  type RequestContext,
} from "@boardstate/server/node";
import { runTransportConformance } from "./suite.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A minimal reference agent loop for the §14 conformance assertions: a text triad, a
 * REAL read tool call driven through the host, a closing text triad, then `turn-end`.
 * The small sleeps give a racing `chat.abort` a deterministic mid-turn window; the
 * signal is honored so an aborted turn stops cleanly (the host emits the terminal).
 */
function makeReferenceAgent(host: InProcessHost): ChatAgent {
  return async ({ sessionKey }, ctx) => {
    const { emit, turnId, signal } = ctx;
    emit({ type: "turn-start", sessionKey, turnId });

    emit({ type: "text-start", sessionKey, turnId, id: "t1" });
    emit({ type: "text-delta", sessionKey, turnId, id: "t1", delta: "Working" });
    await sleep(5);
    if (signal.aborted) {
      return;
    }
    emit({ type: "text-delta", sessionKey, turnId, id: "t1", delta: "…" });
    emit({ type: "text-end", sessionKey, turnId, id: "t1" });

    const callId = "c1";
    emit({ type: "tool-call-start", sessionKey, turnId, callId, name: "dashboard.workspace.get" });
    emit({
      type: "tool-call-ready",
      sessionKey,
      turnId,
      callId,
      name: "dashboard.workspace.get",
      args: {},
    });
    const result = await host.request("dashboard.workspace.get", {});
    emit({ type: "tool-result", sessionKey, turnId, callId, ok: true, result });

    await sleep(5);
    if (signal.aborted) {
      return;
    }
    emit({ type: "text-start", sessionKey, turnId, id: "t2" });
    emit({ type: "text-delta", sessionKey, turnId, id: "t2", delta: "Done." });
    emit({ type: "text-end", sessionKey, turnId, id: "t2" });
    emit({ type: "usage", sessionKey, turnId, inputTokens: 10, outputTokens: 20 });
    emit({ type: "turn-end", sessionKey, turnId, stopReason: "end" });
  };
}

/** A fresh reference host; `dataRead` points at an isolated real temp dir. */
async function makeReferenceHost(): Promise<{
  host: ReturnType<typeof createInProcessHost>;
  dataDir: string;
}> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "boardstate-conformance-"));
  const storage = new MemoryStorageAdapter();
  const store = new DashboardStore({ storage });
  const host = createInProcessHost(store, storage);
  const chat = createChatSessions({ broadcast: host.broadcast });
  registerBoardstateRpc(host, {
    store,
    dataRead: { stateDir: dataDir },
    chat,
    chatAgent: makeReferenceAgent(host),
    ...nodeRpcDeps(),
  });
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
    chat: true,
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
