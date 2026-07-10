// A fake MCP SERVER used only by the broker's tests. It is deliberately tiny but
// exercises every broker code path: a read-only tool, a mutating tool with NO
// `readOnlyHint` (so the broker's fail-safe treats it as a mutation), an `isError`
// tool, and a `sleep` tool for timeout tests. It can be driven two ways with the SAME
// catalog — as a stdio child process (`stdio-entry.ts`) and in-process over HTTP
// (`startHttpFakeServer`) — so the wire-contract test hits both transports with no
// network beyond loopback. `state.mutated` flips the catalog (adds a tool AND changes a
// schema) to drive the anti-rug-pull manifest-hash tests.
//
// Built with the SDK's low-level `Server` + request-handler idiom (mirrors
// packages/mcp/src/mcp-server.ts), not the app store — this is a pure test double.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export const FAKE_SERVER_NAME = "fake-mcp";
export const FAKE_SERVER_VERSION = "0.0.0";

/** Runtime toggle for rug-pull tests: flip `mutated` to change the advertised catalog. */
export type FakeCatalogState = { mutated: boolean };

type FakeTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnlyHint?: boolean;
};

/** The advertised catalog. When `mutated`, `add` gains a `c` operand and `extra` appears. */
function catalog(state: FakeCatalogState): FakeTool[] {
  const tools: FakeTool[] = [
    {
      name: "echo",
      description: "Echo the input text back.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: { text: { type: "string" } },
      },
      readOnlyHint: true,
    },
    {
      name: "add",
      description: "Add two (or, when mutated, three) numbers.",
      inputSchema: state.mutated
        ? {
            type: "object",
            additionalProperties: false,
            required: ["a", "b", "c"],
            properties: { a: { type: "number" }, b: { type: "number" }, c: { type: "number" } },
          }
        : {
            type: "object",
            additionalProperties: false,
            required: ["a", "b"],
            properties: { a: { type: "number" }, b: { type: "number" } },
          },
      readOnlyHint: true,
    },
    {
      // NO readOnlyHint on purpose: the broker must treat it as a mutation (fail-safe).
      name: "write_note",
      description: "Pretend to persist a note (mutating).",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: { text: { type: "string" } },
      },
    },
    {
      name: "boom",
      description: "Always answers with isError:true.",
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      readOnlyHint: true,
    },
    {
      name: "sleep",
      description: "Resolve after `ms` milliseconds (drives timeout tests).",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["ms"],
        properties: { ms: { type: "number" } },
      },
      readOnlyHint: true,
    },
  ];
  if (state.mutated) {
    tools.push({
      name: "extra",
      description: "Only present when the catalog is mutated.",
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      readOnlyHint: true,
    });
  }
  return tools;
}

function textResult(details: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details) }],
    ...(isError ? { isError: true } : {}),
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Build a fresh fake MCP `Server` over the given (possibly shared) catalog state. Not
 * yet connected — hand it a transport (`StdioServerTransport` in the child,
 * `StreamableHTTPServerTransport` in-process).
 */
export function buildFakeMcpServer(state: FakeCatalogState = { mutated: false }): Server {
  const server = new Server(
    { name: FAKE_SERVER_NAME, version: FAKE_SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: catalog(state).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      // Only emit annotations when the hint is set, so `write_note` arrives hint-less
      // and the broker's fail-safe (absent ⇒ mutation) is genuinely exercised.
      ...(tool.readOnlyHint ? { annotations: { readOnlyHint: true } } : {}),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    switch (name) {
      case "echo":
        return textResult({ text: args.text });
      case "add": {
        const sum = Number(args.a) + Number(args.b) + (state.mutated ? Number(args.c) : 0);
        return textResult({ sum });
      }
      case "write_note":
        return textResult({ ok: true, saved: args.text });
      case "boom":
        return textResult({ error: "boom: this tool always fails" }, true);
      case "sleep":
        await sleep(Number(args.ms) || 0);
        return textResult({ slept: Number(args.ms) || 0 });
      case "extra":
        return textResult({ ok: true });
      default:
        return textResult({ error: `unknown tool: ${name}` }, true);
    }
  });

  return server;
}
