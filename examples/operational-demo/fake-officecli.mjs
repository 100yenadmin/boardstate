// A fake "OfficeCLI-flavored" MCP server for the operational demo — so the whole loop
// runs with NO real binary and NO keys. It speaks MCP over stdio (exactly like the real
// `officecli mcp`), advertising two tools that mirror the demo's shape:
//
//   • read_workbook  (readOnly)  — returns a small quarterly-revenue table. A widget
//     binds it with `source:"mcp"` and renders the rows live.
//   • generate_document (mutation, NO readOnlyHint) — "generates" a .docx and returns a
//     path. The broker's fail-safe treats it as a mutation, so it PARKS behind an
//     operator confirm.
//
// To run the demo against the REAL OfficeCLI instead, set OFFICECLI_REAL=1 (see demo.mjs)
// — the preset spawns `officecli mcp` in place of this file. This double is for CI-free
// local runs and for the headless e2e test's cousin (that test uses the broker fixture).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const WORKBOOK = [
  { quarter: "Q1", region: "AMER", revenue: 1820000, deals: 42 },
  { quarter: "Q2", region: "AMER", revenue: 2140000, deals: 51 },
  { quarter: "Q3", region: "AMER", revenue: 2660000, deals: 58 },
  { quarter: "Q3", region: "EMEA", revenue: 1490000, deals: 33 },
];

const TOOLS = [
  {
    name: "read_workbook",
    description: "Read a range from a workbook and return its rows.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string", description: "Workbook path (ignored by this demo double)." },
        range: { type: "string", description: "A1-style range (ignored by this demo double)." },
      },
    },
    readOnlyHint: true,
  },
  {
    // NO readOnlyHint on purpose: the broker's fail-safe treats it as a mutation, so it
    // parks behind an operator confirm.
    name: "generate_document",
    description: "Generate a document (e.g. a .docx report) from a title + body.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title"],
      properties: {
        title: { type: "string" },
        format: { type: "string", enum: ["docx", "pdf"], description: "Default docx." },
      },
    },
  },
];

function textResult(details, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(details) }],
    structuredContent: details,
    ...(isError ? { isError: true } : {}),
  };
}

const server = new Server(
  { name: "fake-officecli", version: "0.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.readOnlyHint ? { annotations: { readOnlyHint: true } } : {}),
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  if (name === "read_workbook") {
    return textResult({ rows: WORKBOOK, source: args.path ?? "quarterly.xlsx" });
  }
  if (name === "generate_document") {
    const format = args.format === "pdf" ? "pdf" : "docx";
    const slug = String(args.title ?? "report")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return textResult({
      ok: true,
      title: args.title ?? "report",
      path: `/tmp/officecli-demo/${slug || "report"}.${format}`,
      generatedAt: new Date().toISOString(),
    });
  }
  return textResult({ error: `unknown tool: ${name}` }, true);
});

const transport = new StdioServerTransport();
await server.connect(transport);
