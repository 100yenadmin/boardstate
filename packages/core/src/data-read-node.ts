// Node-only `file`-binding resolution (SPEC §6): reads the jailed data dir off
// disk. Split out of `data-read.ts` (which stays browser-safe) and reached via
// `@boardstate/core/node`. `resolveBinding` here is the full resolver — it injects
// this file reader into the pure core resolver so a node host resolves every kind.

import fs from "node:fs/promises";
import path from "node:path";
import {
  DashboardBindingResolutionError,
  normalizeDashboardDataLogicalPath,
} from "@boardstate/schema";
import type { DashboardBinding } from "@boardstate/schema";
import { FsStorageAdapter } from "./adapters/storage-fs.js";
import {
  applyJsonPointer,
  resolveBinding as resolveBindingPure,
  type ResolveBindingOptions,
} from "./data-read.js";

const MAX_FILE_BYTES = 1024 * 1024;

/** Resolve the effective state dir: explicit override, else the default adapter's dir. */
function resolveStateDir(stateDir?: string): string {
  return stateDir ?? new FsStorageAdapter().storageDir();
}

function resolveDashboardDataPath(bindingPath: string, stateDir?: string): string {
  const normalized = normalizeDashboardDataLogicalPath(bindingPath);
  const dataRoot = path.resolve(resolveStateDir(stateDir), "dashboard", "data");
  const candidate = path.resolve(dataRoot, normalized);
  if (!(candidate === dataRoot || candidate.startsWith(`${dataRoot}${path.sep}`))) {
    throw new DashboardBindingResolutionError("binding_invalid", "file binding path is invalid");
  }
  return candidate;
}

/** Read + JSON-pointer a `file` binding off disk (jailed under `<stateDir>/dashboard/data`). */
export async function resolveFileBinding(
  binding: Extract<DashboardBinding, { source: "file" }>,
  options: ResolveBindingOptions,
): Promise<unknown> {
  const filePath = resolveDashboardDataPath(binding.path, options.stateDir);
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new DashboardBindingResolutionError("binding_not_found", "file binding not found");
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw new DashboardBindingResolutionError("binding_not_found", "file binding not found");
  }
  if (stat.size > MAX_FILE_BYTES) {
    throw new DashboardBindingResolutionError("binding_too_large", "file binding is too large");
  }
  const content = await fs.readFile(filePath, "utf8");
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".md" || extension === ".csv") {
    return content;
  }
  try {
    return applyJsonPointer(JSON.parse(content), binding.pointer);
  } catch (error) {
    if (error instanceof DashboardBindingResolutionError) {
      throw error;
    }
    throw new DashboardBindingResolutionError("binding_invalid", "file binding JSON is invalid");
  }
}

/** Full (node) binding resolver: the pure core resolver with the fs file reader injected. */
export async function resolveBinding(
  bindingInput: unknown,
  options: ResolveBindingOptions = {},
): Promise<unknown> {
  return await resolveBindingPure(bindingInput, { ...options, resolveFile: resolveFileBinding });
}
