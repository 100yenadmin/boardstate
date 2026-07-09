import { describe, expect, it } from "vitest";
import { openAICompatAdapter } from "./openai-compat.js";
import type { ProviderStreamRequest } from "../types.js";
import { chunkedResponse, collect, fakeFetch, splitEvery, summarize } from "./test-util.js";

const data = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`;

// Well-behaved OpenAI: text, then one tool call whose arguments arrive as fragments, then
// a usage-only final chunk.
const OPENAI_EVENTS = [
  data({
    choices: [{ index: 0, delta: { role: "assistant", content: "On it." }, finish_reason: null }],
  }),
  data({
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call_1",
              type: "function",
              function: { name: "dashboard_tab_create", arguments: "" },
            },
          ],
        },
      },
    ],
  }),
  data({
    choices: [
      { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"title":' } }] } },
    ],
  }),
  data({
    choices: [
      { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"Ops"}' } }] } },
    ],
  }),
  data({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
  data({ choices: [], usage: { prompt_tokens: 30, completion_tokens: 12 } }),
  "data: [DONE]\n\n",
];

// The documented Ollama quirk: two PARALLEL calls both report index:0 with missing ids,
// each carrying its full name+arguments in one fragment. Keying by index would merge them.
const OLLAMA_EVENTS = [
  data({
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            { index: 0, function: { name: "dashboard_widget_add", arguments: '{"tab":"a"}' } },
          ],
        },
        finish_reason: null,
      },
    ],
  }),
  data({
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            { index: 0, function: { name: "dashboard_widget_add", arguments: '{"tab":"b"}' } },
          ],
        },
      },
    ],
  }),
  data({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
  "data: [DONE]\n\n",
];

function buildRequest(fetchImpl: typeof fetch): ProviderStreamRequest & {
  adapter: ReturnType<typeof openAICompatAdapter>;
} {
  const adapter = openAICompatAdapter({
    baseUrl: "https://x/v1",
    apiKey: "k",
    model: "m",
    fetch: fetchImpl,
  });
  return {
    adapter,
    system: "sys",
    messages: [{ role: "user", content: "hi" }],
    tools: [{ name: "dashboard_tab_create", description: "d", parameters: { type: "object" } }],
    signal: new AbortController().signal,
  };
}

describe("openAICompatAdapter", () => {
  it("accumulates tool-call argument fragments and finalizes at finish_reason", async () => {
    const fetchImpl = fakeFetch(() => chunkedResponse(splitEvery(OPENAI_EVENTS.join(""), 25)));
    const req = buildRequest(fetchImpl);
    const deltas = await collect(req.adapter.streamTurn(req));

    expect(summarize(deltas)).toEqual([
      "text-start",
      "text-delta:On it.",
      "tool-call-start:call_1:dashboard_tab_create",
      'tool-call-delta:call_1:{"title":',
      'tool-call-delta:call_1:"Ops"}',
      "text-end",
      'tool-call-ready:call_1:dashboard_tab_create:{"title":"Ops"}',
      "usage:30:12",
      "stop:tool_use",
    ]);
  });

  it("keeps two parallel index:0 calls distinct (Ollama quirk) via synthesized ids", async () => {
    const fetchImpl = fakeFetch(() => chunkedResponse(OLLAMA_EVENTS));
    const req = buildRequest(fetchImpl);
    const deltas = await collect(req.adapter.streamTurn(req));
    const ready = deltas.filter((d) => d.kind === "tool-call-ready");

    expect(ready).toEqual([
      {
        kind: "tool-call-ready",
        callId: "dashboard_widget_add_0",
        name: "dashboard_widget_add",
        args: { tab: "a" },
      },
      {
        kind: "tool-call-ready",
        callId: "dashboard_widget_add_1",
        name: "dashboard_widget_add",
        args: { tab: "b" },
      },
    ]);
    // The two synthesized callIds must differ — proof the calls were NOT merged by index.
    expect(new Set(ready.map((d) => (d.kind === "tool-call-ready" ? d.callId : ""))).size).toBe(2);
  });

  it("emits a retryable error delta on HTTP 500", async () => {
    const fetchImpl = fakeFetch(() => chunkedResponse(["boom"], { status: 500 }));
    const req = buildRequest(fetchImpl);
    const deltas = await collect(req.adapter.streamTurn(req));
    expect(deltas[0]).toMatchObject({ kind: "error", retryable: true });
  });

  it("folds tool errors into the tool message content", () => {
    const adapter = openAICompatAdapter({ baseUrl: "https://x/v1", apiKey: "k", model: "m" });
    expect(adapter.formatToolResult("call_1", { ok: false, value: "denied" })).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: "Error: denied",
    });
    expect(adapter.formatToolResult("call_1", { ok: true, value: { n: 1 } })).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: '{"n":1}',
    });
  });

  it("replays an assistant tool-call turn as role/tool_calls", () => {
    const adapter = openAICompatAdapter({ baseUrl: "https://x/v1", apiKey: "k", model: "m" });
    expect(
      adapter.formatAssistantTurn({
        text: "",
        toolCalls: [{ callId: "call_1", name: "dashboard_tab_create", args: { title: "Ops" } }],
      }),
    ).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "dashboard_tab_create", arguments: '{"title":"Ops"}' },
        },
      ],
    });
  });
});
