// Test helpers: build a chunked SSE `Response`, a fake `fetch`, and collect an async
// iterable. Kept out of `*.test.ts` so multiple test files share them.

import type { ProviderDelta } from "../types.js";

/** A `Response` whose body streams `chunks` back in order (each chunk one network read). */
export function chunkedResponse(chunks: string[], init: ResponseInit = { status: 200 }): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, init);
}

/** Join SSE events and re-split at every `size` chars to exercise cross-chunk framing. */
export function splitEvery(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}

/** A `fetch` stand-in that returns `factory()` (fresh per call, so bodies aren't reused). */
export function fakeFetch(factory: () => Response | Promise<Response>): typeof fetch {
  return (async () => factory()) as unknown as typeof fetch;
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
  }
  return out;
}

/** Compact a delta stream to `[kind, ...key fields]` tuples for terse assertions. */
export function summarize(deltas: ProviderDelta[]): string[] {
  return deltas.map((delta) => {
    switch (delta.kind) {
      case "text-delta":
        return `text-delta:${delta.delta}`;
      case "tool-call-start":
        return `tool-call-start:${delta.callId}:${delta.name}`;
      case "tool-call-delta":
        return `tool-call-delta:${delta.callId}:${delta.argsTextDelta}`;
      case "tool-call-ready":
        return `tool-call-ready:${delta.callId}:${delta.name}:${JSON.stringify(delta.args)}`;
      case "usage":
        return `usage:${delta.inputTokens}:${delta.outputTokens}`;
      case "stop":
        return `stop:${delta.reason}`;
      case "error":
        return `error:${delta.code}:${delta.retryable}`;
      default:
        return delta.kind;
    }
  });
}
