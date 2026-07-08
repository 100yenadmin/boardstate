// Pure argument parsers for the dashboard CLI. Kept separate from the command tree
// so the grid + binding-shorthand grammar is unit-testable in isolation.

import type { DashboardBinding, DashboardGrid, JsonValue } from "@boardstate/schema";

export function parseJson(value: string, label: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch (error) {
    throw new Error(`invalid ${label} JSON: ${(error as Error).message}`, { cause: error });
  }
}

export function parseOptionalBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`invalid boolean: ${value}`);
}

export function parseDashboardGrid(value: string): DashboardGrid {
  const parts = value.split(",").map((entry) => Number(entry.trim()));
  if (parts.length !== 4 || parts.some((entry) => !Number.isInteger(entry))) {
    throw new Error("grid must be x,y,w,h");
  }
  const [x, y, w, h] = parts as [number, number, number, number];
  return { x, y, w, h };
}

export function parseDashboardBindingShorthand(value: string): [string, DashboardBinding] {
  const eqIndex = value.indexOf("=");
  if (eqIndex <= 0) {
    throw new Error("binding must be id=file:<path>, id=rpc:<method>, or id=static:<json>");
  }
  const id = value.slice(0, eqIndex).trim();
  const body = value.slice(eqIndex + 1).trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(id)) {
    throw new Error("binding id is invalid");
  }
  if (body.startsWith("file:")) {
    const fileSpec = body.slice("file:".length);
    const hashIndex = fileSpec.indexOf("#");
    const bindingPath = hashIndex >= 0 ? fileSpec.slice(0, hashIndex) : fileSpec;
    const pointer = hashIndex >= 0 ? fileSpec.slice(hashIndex + 1) : undefined;
    if (!bindingPath) {
      throw new Error("file binding path is required");
    }
    return [
      id,
      {
        source: "file",
        path: bindingPath,
        ...(pointer !== undefined ? { pointer } : {}),
      },
    ];
  }
  if (body.startsWith("rpc:")) {
    const method = body.slice("rpc:".length).trim();
    if (!method) {
      throw new Error("rpc binding method is required");
    }
    return [id, { source: "rpc", method }];
  }
  if (body.startsWith("static:")) {
    return [id, { source: "static", value: parseJson(body.slice("static:".length), "static") }];
  }
  throw new Error("binding source must be file, rpc, or static");
}

export function collectBinding(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function parseBindings(
  values: string[] | undefined,
): Record<string, DashboardBinding> | undefined {
  if (!values?.length) {
    return undefined;
  }
  return Object.fromEntries(values.map(parseDashboardBindingShorthand));
}
