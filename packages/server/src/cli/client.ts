// The CLI's control-plane client. A `BoardstateClient` is a thin wrapper over a
// `Transport` (the same seam the conformance suite and UI drive), so the CLI is just
// another protocol client. `--state-dir` builds an in-process host over the local
// state dir (no server needed); `--url` targets a remote host's JSON endpoint.

import type { Command } from "commander";
import { DashboardStore, FsStorageAdapter, type Transport } from "@boardstate/core";
import { createInProcessHost } from "../host.js";
import { registerBoardstateRpc } from "../rpc.js";

export type ClientOptions = {
  url?: string;
  stateDir?: string;
  token?: string;
  timeout?: string;
};

/** A minimal control-plane client: forwards named methods to its transport. */
export class BoardstateClient {
  constructor(private readonly transport: Transport) {}

  async request(method: string, params?: unknown): Promise<unknown> {
    return await this.transport.request(method, params);
  }
}

/** JSON-over-HTTP transport for a remote host. Read/write both POST `{ method, params }`. */
class HttpTransport implements Transport {
  constructor(
    private readonly url: string,
    private readonly token?: string,
    private readonly timeoutMs?: number,
  ) {}

  async request(method: string, params?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer =
      this.timeoutMs && this.timeoutMs > 0
        ? setTimeout(() => controller.abort(), this.timeoutMs)
        : undefined;
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({ method, params }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        result?: unknown;
        error?: { message?: string };
      };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error?.message ?? `request failed: ${method}`);
      }
      return payload.result ?? payload;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  addEventListener(): () => void {
    // The CLI is request/response only; a remote event stream is out of scope.
    return () => {};
  }
}

/** Add the `--url` / `--state-dir` transport-selection options to a command. */
export function addClientOptions(command: Command): Command {
  return command
    .option("--url <url>", "Remote host control-plane URL")
    .option("--state-dir <dir>", "Local state dir (in-process host)")
    .option("--token <token>", "Bearer token for --url")
    .option("--timeout <ms>", "Request timeout in ms for --url");
}

/**
 * Build a client from parsed command options. `--url` wins; otherwise an in-process
 * host is stood up over `--state-dir` (or the packet-supplied default), reading and
 * writing the same on-disk workspace as every other face of the store.
 */
export function clientFromOptions(
  options: ClientOptions,
  defaultStateDir?: string,
): BoardstateClient {
  if (options.url) {
    const timeout = options.timeout ? Number(options.timeout) : undefined;
    return new BoardstateClient(new HttpTransport(options.url, options.token, timeout));
  }
  const stateDir = options.stateDir ?? defaultStateDir;
  const storage = new FsStorageAdapter(stateDir ? { storageDir: stateDir } : {});
  const store = new DashboardStore({ storage });
  const host = createInProcessHost(store, storage);
  registerBoardstateRpc(host, { store });
  return new BoardstateClient(host);
}
