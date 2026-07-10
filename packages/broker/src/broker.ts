// `McpBroker`: the MCP CLIENT manager. It connects OUTWARD to the external MCP servers
// an operator declared (config.ts), discovers their tools into one `ToolManifest`, and
// calls those tools behind a narrow, namespaced API the host/server layers consume.
//
// Design invariants (epic #37):
//  • Config-only: a connector name not in the config is never resolved — no ambient,
//    doc-introduced, or model-introduced server can be reached.
//  • Lazy + pooled: a connector connects on first use and stays warm; a dropped
//    transport reconnects on next use with capped exponential backoff.
//  • Namespaced surface: callers speak `connector:tool` (or the provider-safe
//    `connector__tool`); the broker strips the namespace before hitting the server.
//  • Fail-safe reads: `readOnlyHint` absent ⇒ a tool is a mutation (manifest.ts).
//  • Secret hygiene: `env` values are env-var NAMES; resolved values are forwarded to
//    the transport but NEVER placed in an error, a log line, or the manifest.
//
// This package depends only on `@modelcontextprotocol/sdk` and `@boardstate/server`
// (types only). It must not import core/host/lit/schema.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectorConfig, ConnectorsConfig } from "./config.js";
import {
  BrokerConnectError,
  BrokerError,
  BrokerTimeoutError,
  BrokerToolError,
  BrokerUnknownConnectorError,
} from "./errors.js";
import { buildManifest, type DiscoveredTool, type ToolManifest } from "./manifest.js";
import { parseManifestId } from "./names.js";

const CLIENT_NAME = "boardstate-broker";
const CLIENT_VERSION = "0.1.0";

/** Tunable connect/backoff policy; every field has a safe default. */
export type BrokerOptions = {
  /** Max connect attempts before a connector's connect rejects. Default 4. */
  maxConnectAttempts?: number;
  /** First backoff delay (ms); doubles each retry up to `maxBackoffMs`. Default 100. */
  initialBackoffMs?: number;
  /** Backoff ceiling (ms). Default 5000. */
  maxBackoffMs?: number;
  /** Default per-call timeout (ms) when `callTool` is given none. Default 30000. */
  defaultCallTimeoutMs?: number;
  /**
   * Reads process env for `env`/header refs. Injectable for tests; defaults to
   * `process.env`. A missing referenced var is a connect error (never the value).
   */
  env?: Record<string, string | undefined>;
  /**
   * Build the transport(s) for a connector, freshest-first. Injectable so tests can
   * drive the broker over an in-memory pair; defaults to the real stdio/http transports.
   * Returning more than one transport requests an ordered fallback (http → SSE): each is
   * tried in turn within a single connect attempt.
   */
  transportFactory?: (
    connector: ConnectorConfig,
    env: Record<string, string | undefined>,
  ) => Transport | Transport[];
};

type ConnectorRuntime = {
  config: ConnectorConfig;
  client?: Client;
  /** In-flight connect, shared so concurrent callers don't open duplicate clients. */
  connecting?: Promise<Client>;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Interpolate `${ENV_NAME}` refs in a header value against resolved env (fail-closed). */
function resolveHeaderValue(
  connector: string,
  header: string,
  raw: string,
  env: Record<string, string | undefined>,
): string {
  return raw.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const value = env[name];
    if (value === undefined) {
      throw new BrokerConnectError(
        `connector "${connector}": header "${header}" references env var ${name}, which is not set`,
      );
    }
    return value;
  });
}

/** Resolve an `env` ref map ({ CHILD: SOURCE }) into concrete values (never logged). */
function resolveEnvRefs(
  connector: string,
  refs: Record<string, string> | undefined,
  env: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [childVar, sourceName] of Object.entries(refs ?? {})) {
    const value = env[sourceName];
    if (value === undefined) {
      throw new BrokerConnectError(
        `connector "${connector}": env["${childVar}"] references ${sourceName}, which is not set`,
      );
    }
    out[childVar] = value;
  }
  return out;
}

/**
 * The default transport builder: a stdio transport for local servers, or an ordered
 * [Streamable HTTP, SSE] pair for remotes. The broker tries Streamable HTTP first and
 * falls back to the legacy SSE transport when the modern endpoint won't connect
 * (Pipedream/Composio-class servers that only speak SSE).
 */
function defaultTransportFactory(
  connector: ConnectorConfig,
  env: Record<string, string | undefined>,
): Transport[] {
  if (connector.transport === "stdio") {
    const resolvedEnv = resolveEnvRefs(connector.name, connector.env, env);
    return [
      new StdioClientTransport({
        command: connector.command as string,
        args: connector.args,
        // Only the operator-referenced vars are forwarded — no ambient inheritance.
        env: resolvedEnv,
      }),
    ];
  }
  const url = new URL(connector.url as string);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(connector.headers ?? {})) {
    headers[key] = resolveHeaderValue(connector.name, key, value, env);
  }
  const requestInit: RequestInit = Object.keys(headers).length > 0 ? { headers } : {};
  return [
    new StreamableHTTPClientTransport(url, { requestInit }),
    new SSEClientTransport(url, { requestInit }),
  ];
}

export class McpBroker {
  private readonly runtimes = new Map<string, ConnectorRuntime>();
  private readonly options: Required<Omit<BrokerOptions, "env" | "transportFactory">> & {
    env: Record<string, string | undefined>;
    transportFactory: NonNullable<BrokerOptions["transportFactory"]>;
  };

  constructor(config: ConnectorsConfig, options: BrokerOptions = {}) {
    for (const connector of config.connectors) {
      this.runtimes.set(connector.name, { config: connector });
    }
    this.options = {
      maxConnectAttempts: options.maxConnectAttempts ?? 4,
      initialBackoffMs: options.initialBackoffMs ?? 100,
      maxBackoffMs: options.maxBackoffMs ?? 5000,
      defaultCallTimeoutMs: options.defaultCallTimeoutMs ?? 30000,
      env: options.env ?? process.env,
      transportFactory: options.transportFactory ?? defaultTransportFactory,
    };
  }

  /** The operator-declared connector names, in config order. */
  connectorNames(): string[] {
    return [...this.runtimes.keys()];
  }

  private runtime(name: string): ConnectorRuntime {
    const runtime = this.runtimes.get(name);
    if (!runtime) {
      throw new BrokerUnknownConnectorError(
        `connector "${name}" is not in the operator config — refusing to connect`,
      );
    }
    return runtime;
  }

  /**
   * Ensure a connector is connected, returning its warm client. Concurrent callers share
   * one in-flight connect; a dropped transport (cleared on close) reconnects here.
   */
  private async ensureConnected(name: string): Promise<Client> {
    const runtime = this.runtime(name);
    if (runtime.client) {
      return runtime.client;
    }
    if (runtime.connecting) {
      return runtime.connecting;
    }
    const connect = this.connectWithBackoff(runtime).then(
      (client) => {
        runtime.client = client;
        runtime.connecting = undefined;
        return client;
      },
      (error) => {
        runtime.connecting = undefined;
        throw error;
      },
    );
    runtime.connecting = connect;
    return connect;
  }

  private async connectWithBackoff(runtime: ConnectorRuntime): Promise<Client> {
    const { maxConnectAttempts, initialBackoffMs, maxBackoffMs } = this.options;
    let lastError: unknown;
    for (let attempt = 0; attempt < maxConnectAttempts; attempt += 1) {
      if (attempt > 0) {
        await sleep(Math.min(initialBackoffMs * 2 ** (attempt - 1), maxBackoffMs));
      }
      // Fresh transports each attempt — a failed/closed transport can't be reused. The
      // http builder returns [streamable, sse]; we try them in order (SSE fallback).
      const built = this.options.transportFactory(runtime.config, this.options.env);
      const transports = Array.isArray(built) ? built : [built];
      for (const transport of transports) {
        const client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION });
        // A transport drop after a successful connect evicts the warm client so the NEXT
        // use reconnects (rather than calling a dead client).
        client.onclose = () => {
          if (runtime.client === client) {
            runtime.client = undefined;
          }
        };
        try {
          await client.connect(transport);
          return client;
        } catch (error) {
          lastError = error;
          await client.close().catch(() => {});
        }
      }
    }
    throw new BrokerConnectError(
      `connector "${runtime.config.name}" failed to connect after ${maxConnectAttempts} attempt(s): ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
      { cause: lastError },
    );
  }

  /** Discover one connector's tools (connecting lazily). */
  private async discover(name: string): Promise<DiscoveredTool[]> {
    const client = await this.ensureConnected(name);
    const result = await client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description !== undefined ? { description: tool.description } : {}),
      inputSchema: tool.inputSchema as Record<string, unknown>,
      ...(tool.annotations ? { annotations: { readOnlyHint: tool.annotations.readOnlyHint } } : {}),
    }));
  }

  /**
   * Discover every connector's tools into one {@link ToolManifest} (namespaced ids +
   * provider-safe names + stable hash). Connects lazily; a connector that fails to
   * connect propagates its {@link BrokerConnectError}.
   */
  async listTools(): Promise<ToolManifest> {
    const discovered = new Map<string, DiscoveredTool[]>();
    for (const name of this.runtimes.keys()) {
      discovered.set(name, await this.discover(name));
    }
    return buildManifest(discovered);
  }

  /**
   * Call a tool by its `connector:tool` id OR its provider-safe `connector__tool` name.
   * Strips the namespace, enforces a hard timeout, and normalizes an `isError: true`
   * result into a typed {@link BrokerToolError}.
   */
  async callTool(
    toolRef: string,
    args: Record<string, unknown> = {},
    opts: { timeout?: number; providerToId?: ReadonlyMap<string, string> } = {},
  ): Promise<{ content: unknown; structuredContent?: unknown }> {
    const id = opts.providerToId?.get(toolRef) ?? toolRef;
    const { connector, tool } = parseManifestId(id);
    const client = await this.ensureConnected(connector);
    const timeout = opts.timeout ?? this.options.defaultCallTimeoutMs;

    let result: Awaited<ReturnType<Client["callTool"]>>;
    try {
      result = await client.callTool({ name: tool, arguments: args }, undefined, { timeout });
    } catch (error) {
      if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) {
        throw new BrokerTimeoutError(`tool "${id}" timed out after ${timeout}ms`);
      }
      if (error instanceof BrokerError) {
        throw error;
      }
      throw new BrokerToolError(id, error instanceof Error ? error.message : String(error));
    }

    if (result.isError === true) {
      throw new BrokerToolError(id, extractErrorText(result.content));
    }
    return {
      content: result.content,
      ...(result.structuredContent !== undefined
        ? { structuredContent: result.structuredContent }
        : {}),
    };
  }

  /** Close every warm client. Idempotent; safe to call in a `finally`. */
  async close(): Promise<void> {
    const closing: Promise<void>[] = [];
    for (const runtime of this.runtimes.values()) {
      const client = runtime.client;
      runtime.client = undefined;
      runtime.connecting = undefined;
      if (client) {
        closing.push(client.close().catch(() => {}));
      }
    }
    await Promise.all(closing);
  }
}

/** Best-effort human text out of an MCP tool result's `content` blocks. */
function extractErrorText(content: unknown): string {
  if (Array.isArray(content)) {
    const text = content
      .filter((block): block is { type: string; text: string } => {
        return (
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "text" &&
          typeof (block as { text?: unknown }).text === "string"
        );
      })
      .map((block) => block.text)
      .join("\n");
    if (text.length > 0) {
      return text;
    }
  }
  return "tool returned isError with no text content";
}
