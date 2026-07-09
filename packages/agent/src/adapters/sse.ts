// A minimal Server-Sent-Events frame reader over a fetch `ReadableStream`. Frames are
// separated by a blank line; a frame's `data:` lines are joined with "\n" and its
// optional `event:` line is surfaced (Anthropic uses named events, OpenAI does not).
// Partial frames are buffered across network chunks, so a `data:`/`event:` line split
// mid-flight is reassembled correctly.

export type SseFrame = { event?: string; data: string };

function parseFrame(block: string): SseFrame | undefined {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) {
      // Blank line or a comment/heartbeat (": heartbeat"): ignore.
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      // A single leading space after the colon is part of the SSE framing, not data.
      dataLines.push(line.slice("data:".length).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) {
    return undefined;
  }
  return event !== undefined
    ? { event, data: dataLines.join("\n") }
    : { data: dataLines.join("\n") };
}

/** Yield decoded SSE frames from a response body, reassembling across chunk boundaries. */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      if (signal?.aborted) {
        return;
      }
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const frame = parseFrame(part);
        if (frame) {
          yield frame;
        }
      }
    }
    const tail = parseFrame(buffer);
    if (tail) {
      yield tail;
    }
  } finally {
    reader.releaseLock();
  }
}
