import { DashboardStore, MemoryStorageAdapter } from "@boardstate/core";
import { afterEach, describe, expect, it } from "vitest";
import { createBoardstateMcpServer } from "./mcp-server.js";
import { startServeHost, type ServeHostHandle } from "./serve-host.js";

let handle: ServeHostHandle | null = null;

afterEach(async () => {
  if (handle) {
    await handle.close();
    handle = null;
  }
});

describe("--serve demo host", () => {
  it("serves the workspace and forwards writes over /rpc while streaming SSE", async () => {
    const store = new DashboardStore({ storage: new MemoryStorageAdapter() });
    const { host } = createBoardstateMcpServer({ store });
    // Port 0 → OS-assigned free port; the handle reports the real bound port.
    handle = await startServeHost({ store, host, port: 0 });
    expect(handle).not.toBeNull();
    const base = handle!.url;

    const page = await fetch(base);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");

    // Subscribe to the SSE stream before mutating so we observe the change event.
    const events = await fetch(`${base}events`, { headers: { accept: "text/event-stream" } });
    const reader = events.body!.getReader();

    const rpc = await fetch(`${base}rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "dashboard.tab.create", params: { title: "SSE" } }),
    });
    expect(rpc.status).toBe(200);
    const rpcBody = (await rpc.json()) as { result: { doc: { tabs: Array<{ title: string }> } } };
    expect(rpcBody.result.doc.tabs.some((tab) => tab.title === "SSE")).toBe(true);

    // The write must land in the store and stream a boardstate.changed SSE frame.
    expect((await store.read()).tabs.some((tab) => tab.title === "SSE")).toBe(true);
    const decoder = new TextDecoder();
    let stream = "";
    for (let reads = 0; reads < 5 && !stream.includes("boardstate.changed"); reads += 1) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      stream += decoder.decode(chunk.value, { stream: true });
    }
    expect(stream).toContain("event: boardstate.changed");
    await reader.cancel();
  });

  it("mounts the real element from the built browser bundle", async () => {
    // The bundle is built by the repo gate (`pnpm build`) before tests run; this
    // asserts the acceptance demo — `--serve` renders the standalone board.
    const store = new DashboardStore({ storage: new MemoryStorageAdapter() });
    const { host } = createBoardstateMcpServer({ store });
    handle = await startServeHost({ store, host, port: 0 });
    const base = handle!.url;

    const page = await (await fetch(base)).text();
    expect(page).toContain("/boardstate.js");
    expect(page).toContain("boardstate-view");

    const bundle = await fetch(`${base}boardstate.js`);
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get("content-type")).toContain("javascript");
    const bundleSource = await bundle.text();
    // The served file is the self-contained element bundle (custom elements defined).
    expect(bundleSource).toContain("boardstate-view");

    const css = await fetch(`${base}boardstate.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
  });

  it("reports a control-plane error as a 400 over /rpc", async () => {
    const store = new DashboardStore({ storage: new MemoryStorageAdapter() });
    const { host } = createBoardstateMcpServer({ store });
    handle = await startServeHost({ store, host, port: 0 });
    const res = await fetch(`${handle!.url}rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "dashboard.tab.create", params: {} }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining("title"),
    });
  });
});
