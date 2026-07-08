// The host seam for @boardstate/server.
//
// A `ServerHost` is what the control plane (rpc.ts), the agent tools (tools.ts),
// and the widget-asset route (http-route.ts) register themselves into. A conformant
// Boardstate host provides one; `createInProcessHost` is the reference in-process
// implementation that the conformance suite and the example app run against — it
// registers RPCs into a Map and IS a `Transport` (a real client can drive it over
// `request` + `addEventListener` with no network in between).

import type { IncomingMessage, ServerResponse } from "node:http";
import type { DashboardStore, StorageAdapter, Transport } from "@boardstate/core";
import type { TSchema } from "typebox";

/** Read methods never mutate; write methods commit through the store. */
export type RpcScope = "read" | "write";

/**
 * The `respond`/`broadcast` surface a single RPC handler is given. Mirrors the
 * request/respond shape the handlers were authored against: `respond(true, result)`
 * resolves the caller's `request`, `respond(false, undefined, { code, message })`
 * rejects it with an error carrying `.code`. `operatorId` is the resolved,
 * fail-closed operator identity for private-tab scoping (`null` when unidentified).
 */
export type RpcHandlerContext = {
  params: unknown;
  respond: (ok: boolean, result?: unknown, error?: { code: string; message: string }) => void;
  broadcast: (event: string, payload: unknown) => void;
  operatorId: string | null;
};

export type RpcHandler = (ctx: RpcHandlerContext) => void | Promise<void>;

/** Per-call connection identity threaded from the transport into a request. */
export type ToolContext = { agentId?: string; sessionKey?: string };

/** A resolved request context: a `ToolContext` plus an optional explicit operator. */
export type RequestContext = ToolContext & { operatorId?: string | null };

export type AgentToolResult = { details: unknown };

/** The agent-facing tool shape (typebox-validated params + an execute fn). */
export type AgentTool = {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  execute: (toolCallId: string, params: unknown) => AgentToolResult | Promise<AgentToolResult>;
};

/** A node HTTP route handler: returns true when it owned (handled) the request. */
export type NodeHttpHandler = {
  handleHttpRequest: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
};

/**
 * The registration seam a host exposes to the control plane. `identify` is the
 * OPTIONAL operator-identity seam (SPEC §11-I6): given a per-connection context it
 * returns a stable operator id, or undefined. Absent/undefined ⇒ fail-closed
 * (`null`), so an unidentified caller can never see or own a private tab.
 */
export interface ServerHost {
  registerRpc(name: string, handler: RpcHandler, opts: { scope: RpcScope }): void;
  registerTool(factory: () => AgentTool[], opts: { names: string[] }): void;
  registerHttpRoute(spec: { prefix: string; handler: NodeHttpHandler }): void;
  broadcast(event: string, payload: unknown): void;
  identify?(ctx: ToolContext): string | undefined;
}

/** Format any thrown value into a wire-safe error message. */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Wrap a JSON-serializable value as an agent-tool result. */
export function toolJson(details: unknown): AgentToolResult {
  return { details };
}

type RegisteredRpc = { handler: RpcHandler; scope: RpcScope };

/** The in-process reference host: a `ServerHost` that is also a `Transport`. */
export type InProcessHost = ServerHost &
  Transport & {
    readonly store: DashboardStore;
    /** Drive a registered method directly (the Transport `request`, with optional identity). */
    request(method: string, params?: unknown, ctx?: RequestContext): Promise<unknown>;
    /** Registered RPC methods in registration order, with their scopes. */
    listRpc(): Array<{ name: string; scope: RpcScope }>;
    /** All tools produced by the registered factories. */
    tools(): AgentTool[];
    /** All registered HTTP routes. */
    httpRoutes(): Array<{ prefix: string; handler: NodeHttpHandler }>;
  };

export type CreateInProcessHostOptions = {
  /** Operator-identity seam (SPEC §11-I6). Fail-closed when omitted. */
  identify?(ctx: ToolContext): string | undefined;
};

/**
 * Build the in-process reference host over a store + storage adapter. The returned
 * object registers RPCs/tools/routes into in-memory maps, dispatches broadcasts to
 * `addEventListener` subscribers, and exposes `request(method, params, ctx)` so a
 * client (or the conformance suite) drives the control plane with zero transport in
 * between — exactly the seam the wire-contract lesson (SPEC §12) demands.
 */
export function createInProcessHost(
  store: DashboardStore,
  storage: StorageAdapter,
  options: CreateInProcessHostOptions = {},
): InProcessHost {
  void storage;
  const rpcs = new Map<string, RegisteredRpc>();
  const order: string[] = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const toolFactories: Array<() => AgentTool[]> = [];
  const routes: Array<{ prefix: string; handler: NodeHttpHandler }> = [];
  const identify = options.identify;

  function broadcast(event: string, payload: unknown): void {
    const subscribers = listeners.get(event);
    if (!subscribers) {
      return;
    }
    for (const fn of [...subscribers]) {
      fn(payload);
    }
  }

  function resolveOperatorId(ctx: RequestContext | undefined): string | null {
    if (ctx && ctx.operatorId !== undefined) {
      return ctx.operatorId;
    }
    if (identify) {
      return identify(ctx ?? {}) ?? null;
    }
    return null;
  }

  const host: InProcessHost = {
    store,
    registerRpc(name, handler, opts) {
      if (rpcs.has(name)) {
        throw new Error(`duplicate rpc method: ${name}`);
      }
      rpcs.set(name, { handler, scope: opts.scope });
      order.push(name);
    },
    registerTool(factory) {
      toolFactories.push(factory);
    },
    registerHttpRoute(spec) {
      routes.push(spec);
    },
    broadcast,
    ...(identify ? { identify } : {}),
    listRpc() {
      return order.map((name) => ({ name, scope: rpcs.get(name)!.scope }));
    },
    tools() {
      return toolFactories.flatMap((factory) => factory());
    },
    httpRoutes() {
      return [...routes];
    },
    request(method, params, ctx) {
      const entry = rpcs.get(method);
      if (!entry) {
        const error = new Error(`unknown method: ${method}`) as Error & { code: string };
        error.code = "method_not_found";
        return Promise.reject(error);
      }
      return new Promise<unknown>((resolve, reject) => {
        let settled = false;
        const respond = (
          ok: boolean,
          result?: unknown,
          error?: { code: string; message: string },
        ): void => {
          if (settled) {
            return;
          }
          settled = true;
          if (ok) {
            resolve(result);
            return;
          }
          const err = new Error(error?.message ?? "boardstate error") as Error & { code?: string };
          if (error?.code !== undefined) {
            err.code = error.code;
          }
          reject(err);
        };
        Promise.resolve(
          entry.handler({
            params: params ?? {},
            respond,
            broadcast,
            operatorId: resolveOperatorId(ctx),
          }),
        ).catch((error) => {
          const code =
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof (error as { code: unknown }).code === "string"
              ? (error as { code: string }).code
              : "boardstate_error";
          respond(false, undefined, { code, message: formatError(error) });
        });
      });
    },
    addEventListener(event, fn) {
      let subscribers = listeners.get(event);
      if (!subscribers) {
        subscribers = new Set();
        listeners.set(event, subscribers);
      }
      subscribers.add(fn);
      return () => {
        subscribers?.delete(fn);
      };
    },
  };

  return host;
}
