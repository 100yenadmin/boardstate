// Node-only, fs-backed custom-widget manifest loading (SPEC §8.1). Split out of
// `manifest.ts` (which stays browser-safe: pure validation) so it can read
// `widget.json` off disk. Reached via `@boardstate/core/node`.

import fs from "node:fs/promises";
import path from "node:path";
import { FsStorageAdapter } from "./adapters/storage-fs.js";
import {
  CUSTOM_WIDGET_NAME_PATTERN,
  MANIFEST_MAX_BYTES,
  validateWidgetManifest,
  type WidgetManifest,
} from "./manifest.js";

/** Resolves the on-disk directory for one custom widget by name. */
export function resolveWidgetDir(name: string, stateDir?: string): string {
  if (!CUSTOM_WIDGET_NAME_PATTERN.test(name)) {
    throw new Error("widget name is invalid");
  }
  const root = stateDir ?? new FsStorageAdapter().storageDir();
  const widgetsRoot = path.resolve(root, "dashboard", "widgets");
  const widgetDir = path.resolve(widgetsRoot, name);
  // Belt-and-braces: the charset check already forbids separators, but confirm
  // containment so the resolved directory can never escape the widgets root.
  if (widgetDir !== widgetsRoot && !widgetDir.startsWith(`${widgetsRoot}${path.sep}`)) {
    throw new Error("widget name is invalid");
  }
  return widgetDir;
}

/** Loads and validates the `widget.json` for a named custom widget, or null if absent. */
export async function loadWidgetManifest(
  name: string,
  options: { stateDir?: string } = {},
): Promise<WidgetManifest | null> {
  const widgetDir = resolveWidgetDir(name, options.stateDir);
  const manifestPath = path.join(widgetDir, "widget.json");
  let raw: string;
  try {
    const stat = await fs.stat(manifestPath);
    if (!stat.isFile() || stat.size > MANIFEST_MAX_BYTES) {
      return null;
    }
    raw = await fs.readFile(manifestPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("widget.json is not valid JSON", { cause: error });
  }
  return validateWidgetManifest(parsed, name);
}
