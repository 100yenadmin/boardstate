// Small shared helpers for the provider adapters.

/** Render any tool value as text for a tool-result message. Strings pass through. */
export function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

/** Parse accumulated tool-arg text, falling back on empty/invalid JSON (partial models). */
export function parseJsonOr<T>(text: string, fallback: T): T {
  const trimmed = text.trim();
  if (!trimmed) {
    return fallback;
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return fallback;
  }
}

/** Read an error-response body without letting a body error mask the status. */
export async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
