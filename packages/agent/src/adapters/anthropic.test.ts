import { describe, expect, it } from "vitest";
import { anthropicAdapter } from "./anthropic.js";
import type { ProviderStreamRequest } from "../types.js";
import { chunkedResponse, collect, fakeFetch, splitEvery, summarize } from "./test-util.js";

// A realistic Anthropic Messages stream: a text block, then two PARALLEL tool_use blocks
// whose `input_json_delta` fragments are split across events (and, via splitEvery, across
// network chunks). The second tool block opens and closes INSIDE the first's window to
// exercise concurrent-block routing.
const EVENTS = [
  `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 25, output_tokens: 0 } } })}\n\n`,
  `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text" } })}\n\n`,
  `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me " } })}\n\n`,
  `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "build that." } })}\n\n`,
  `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
  `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "dashboard_tab_create" } })}\n\n`,
  `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"title":' } })}\n\n`,
  `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_2", name: "dashboard_workspace_get" } })}\n\n`,
  `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"Sales"}' } })}\n\n`,
  `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "{}" } })}\n\n`,
  `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 2 })}\n\n`,
  `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 1 })}\n\n`,
  `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 42 } })}\n\n`,
  `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
];

function request(
  fetchImpl: typeof fetch,
): ProviderStreamRequest & { adapter: ReturnType<typeof anthropicAdapter> } {
  const adapter = anthropicAdapter({ apiKey: "k", model: "m", fetch: fetchImpl });
  return {
    adapter,
    system: "sys",
    messages: [{ role: "user", content: "build sales" }],
    tools: [
      { name: "dashboard_tab_create", description: "d", parameters: { type: "object" } },
      { name: "dashboard_workspace_get", description: "d", parameters: { type: "object" } },
    ],
    signal: new AbortController().signal,
  };
}

describe("anthropicAdapter", () => {
  it("parses text + parallel tool_use blocks into an ordered delta stream", async () => {
    // Re-chunk every 30 chars so SSE frames split mid-line across network reads.
    const fetchImpl = fakeFetch(() => chunkedResponse(splitEvery(EVENTS.join(""), 30)));
    const req = request(fetchImpl);
    const deltas = await collect(req.adapter.streamTurn(req));

    expect(summarize(deltas)).toEqual([
      "text-start",
      "text-delta:Let me ",
      "text-delta:build that.",
      "text-end",
      "tool-call-start:toolu_1:dashboard_tab_create",
      'tool-call-delta:toolu_1:{"title":',
      "tool-call-start:toolu_2:dashboard_workspace_get",
      'tool-call-delta:toolu_1:"Sales"}',
      "tool-call-delta:toolu_2:{}",
      "tool-call-ready:toolu_2:dashboard_workspace_get:{}",
      'tool-call-ready:toolu_1:dashboard_tab_create:{"title":"Sales"}',
      "usage:25:42",
      "stop:tool_use",
    ]);
  });

  it("parses the accumulated tool args only at content_block_stop", async () => {
    const fetchImpl = fakeFetch(() => chunkedResponse(EVENTS));
    const req = request(fetchImpl);
    const deltas = await collect(req.adapter.streamTurn(req));
    const ready = deltas.filter((d) => d.kind === "tool-call-ready");
    expect(ready).toContainEqual({
      kind: "tool-call-ready",
      callId: "toolu_1",
      name: "dashboard_tab_create",
      args: { title: "Sales" },
    });
  });

  it("emits a retryable error delta on HTTP 429 with Retry-After", async () => {
    const fetchImpl = fakeFetch(() =>
      chunkedResponse(["rate limited"], { status: 429, headers: { "retry-after": "2" } }),
    );
    const req = request(fetchImpl);
    const deltas = await collect(req.adapter.streamTurn(req));
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ kind: "error", retryable: true, retryAfterMs: 2000 });
  });

  it("classifies a 400 as a non-retryable error delta", async () => {
    const fetchImpl = fakeFetch(() => chunkedResponse(["bad request"], { status: 400 }));
    const req = request(fetchImpl);
    const deltas = await collect(req.adapter.streamTurn(req));
    expect(deltas[0]).toMatchObject({ kind: "error", retryable: false });
  });

  it("classifies a 503 as retryable", async () => {
    const fetchImpl = fakeFetch(() => chunkedResponse(["unavailable"], { status: 503 }));
    const req = request(fetchImpl);
    const deltas = await collect(req.adapter.streamTurn(req));
    expect(deltas[0]).toMatchObject({ kind: "error", retryable: true });
  });

  it("emits a retryable error delta when fetch itself rejects (network)", async () => {
    const fetchImpl = (() =>
      Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
    const req = request(fetchImpl);
    const deltas = await collect(req.adapter.streamTurn(req));
    expect(deltas[0]).toMatchObject({ kind: "error", retryable: true });
  });

  it("formats tool results with is_error and replays the assistant turn", () => {
    const adapter = anthropicAdapter({ apiKey: "k", model: "m" });
    expect(adapter.formatToolResult("toolu_1", { ok: false, value: { error: "boom" } })).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: '{"error":"boom"}',
          is_error: true,
        },
      ],
    });
    expect(
      adapter.formatAssistantTurn({
        text: "ok",
        toolCalls: [{ callId: "toolu_1", name: "dashboard_tab_create", args: { title: "S" } }],
      }),
    ).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "ok" },
        { type: "tool_use", id: "toolu_1", name: "dashboard_tab_create", input: { title: "S" } },
      ],
    });
  });
});
