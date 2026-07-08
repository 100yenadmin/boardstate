// Server-side data-binding resolution (SPEC §6) — the BROWSER-SAFE core. `static`
// returns its value; `rpc`/`stream`/`computed` are resolved client-side and error
// with `binding_client_resolved`; `file` is resolved by an INJECTED node resolver
// (`@boardstate/core/node`), so this module imports no `node:*` and a browser host
// can load it. JSON-pointer application + binding parsing live here (pure).

import { type ComputedOp, DashboardBindingResolutionError } from "@boardstate/schema";
import type { DashboardBinding, JsonValue } from "@boardstate/schema";

export {
  DATA_READ_RPC_ALLOWLIST,
  DashboardBindingResolutionError,
  normalizeDashboardDataLogicalPath,
  type DashboardBindingErrorCode,
} from "@boardstate/schema";

/** Resolves a `file` binding off disk — injected by `@boardstate/core/node`. */
export type ResolveFileBinding = (
  binding: Extract<DashboardBinding, { source: "file" }>,
  options: ResolveBindingOptions,
) => Promise<unknown>;

export type ResolveBindingOptions = {
  stateDir?: string;
  /**
   * Node-side `file`-binding resolver. Absent in a browser host — `file` bindings
   * then error (the browser demo uses `static`/`computed`); a node host injects
   * `resolveFileBinding` from `@boardstate/core/node`.
   */
  resolveFile?: ResolveFileBinding;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBinding(value: unknown): DashboardBinding {
  if (!isRecord(value) || typeof value.source !== "string") {
    throw new DashboardBindingResolutionError("binding_invalid", "binding source is required");
  }
  if (value.source === "static") {
    return { source: "static", value: value.value as JsonValue };
  }
  if (value.source === "rpc") {
    if (typeof value.method !== "string" || !value.method.trim()) {
      throw new DashboardBindingResolutionError(
        "binding_invalid",
        "rpc binding method is required",
      );
    }
    return { source: "rpc", method: value.method };
  }
  if (value.source === "file") {
    if (typeof value.path !== "string") {
      throw new DashboardBindingResolutionError("binding_invalid", "file binding path is required");
    }
    if (value.pointer !== undefined && typeof value.pointer !== "string") {
      throw new DashboardBindingResolutionError(
        "binding_invalid",
        "file binding pointer is invalid",
      );
    }
    return {
      source: "file",
      path: value.path,
      ...(value.pointer !== undefined ? { pointer: value.pointer } : {}),
    };
  }
  if (value.source === "stream") {
    if (typeof value.event !== "string" || !value.event.trim()) {
      throw new DashboardBindingResolutionError(
        "binding_invalid",
        "stream binding event is required",
      );
    }
    return {
      source: "stream",
      event: value.event,
      ...(typeof value.pointer === "string" ? { pointer: value.pointer } : {}),
    };
  }
  if (value.source === "computed") {
    if (typeof value.op !== "string") {
      throw new DashboardBindingResolutionError(
        "binding_invalid",
        "computed binding op is required",
      );
    }
    if (!Array.isArray(value.inputs)) {
      throw new DashboardBindingResolutionError(
        "binding_invalid",
        "computed binding inputs are required",
      );
    }
    return {
      source: "computed",
      op: value.op as ComputedOp,
      inputs: value.inputs as string[],
      ...(typeof value.arg === "string" ? { arg: value.arg } : {}),
    };
  }
  throw new DashboardBindingResolutionError("binding_invalid", "binding source is invalid");
}

function decodePointerSegment(value: string): string {
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
}

/** Apply a JSON pointer to a resolved value. Shared with the node file resolver. */
export function applyJsonPointer(value: unknown, pointer: string | undefined): unknown {
  if (pointer === undefined || pointer === "") {
    return value;
  }
  if (!pointer.startsWith("/")) {
    throw new DashboardBindingResolutionError("binding_invalid", "JSON pointer is invalid");
  }
  let current = value;
  for (const rawSegment of pointer.slice(1).split("/")) {
    const segment = decodePointerSegment(rawSegment);
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new DashboardBindingResolutionError("binding_not_found", "JSON pointer not found");
      }
      current = current[index];
      continue;
    }
    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
      throw new DashboardBindingResolutionError("binding_not_found", "JSON pointer not found");
    }
    current = current[segment];
  }
  return current;
}

export async function resolveBinding(
  bindingInput: unknown,
  options: ResolveBindingOptions = {},
): Promise<unknown> {
  const binding = readBinding(bindingInput);
  if (binding.source === "static") {
    return binding.value;
  }
  if (binding.source === "rpc") {
    throw new DashboardBindingResolutionError(
      "binding_client_resolved",
      "rpc dashboard bindings are resolved by the Control UI gateway client",
    );
  }
  if (binding.source === "stream" || binding.source === "computed") {
    // Neither resolves server-side: `stream` is a client subscription over the
    // gateway WebSocket, `computed` derives from sibling values already resolved
    // in the Control UI. Same client-resolution marker the rpc path uses.
    throw new DashboardBindingResolutionError(
      "binding_client_resolved",
      `${binding.source} dashboard bindings are resolved by the Control UI client`,
    );
  }
  // `file`: node-only. A browser host has no resolver → surface it as client-resolved.
  if (!options.resolveFile) {
    throw new DashboardBindingResolutionError(
      "binding_client_resolved",
      "file dashboard bindings require the node host (@boardstate/core/node)",
    );
  }
  return await options.resolveFile(binding, options);
}
