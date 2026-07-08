// Install a client-fetched custom-widget bundle into the dashboard state dir (SPEC §8.2).
//
// SECURITY — this module NEVER fetches a URL. The operator's browser fetches the
// bundle (subject to CORS), size-caps it, and hands the ALREADY-FETCHED bytes to
// the `dashboard.widget.install` method, which calls this. There is no server-side
// network egress here, so remote fetch cannot be turned into SSRF.
//
// The installed widget lands as `status: "pending"` in `widgetsRegistry`, so the
// operator-approval gate (SPEC §8.2) stands before anything mounts, and the
// approved-only serving gate (serve.ts) + `sandbox="allow-scripts"` iframe still
// apply. Installing NEVER approves and NEVER bypasses the sandbox.

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  CUSTOM_WIDGET_NAME_PATTERN,
  FsStorageAdapter,
  resolveWidgetDir,
  validateWidgetManifest,
  type DashboardStore,
} from "@boardstate/core";
import type { DashboardActor, WorkspaceDoc } from "@boardstate/schema";
import { isServableWidgetFile, normalizeWidgetLogicalPath } from "./serve.js";

/** Hard cap on the total decoded bundle size (mirrored client-side before send). */
export const WIDGET_BUNDLE_MAX_BYTES = 512 * 1024;
/** Cap on the number of files a bundle may carry (defense against zip-bomb-style fan-out). */
export const WIDGET_BUNDLE_MAX_FILES = 64;

export type WidgetBundleInput = {
  /** Custom-widget name (`custom:<name>` kind); must match the manifest name. */
  name: string;
  /** The `widget.json` object, validated here against the shared validator. */
  manifest: unknown;
  /** Logical file path → file text content (index.html, scripts, styles, assets). */
  files: unknown;
};

export type InstallWidgetOptions = {
  actor: DashboardActor;
  stateDir?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/** Atomic file write: temp file in the same dir, then rename over the target. */
async function writeFileAtomic(filePath: string, content: string, mode: number): Promise<void> {
  const dir = path.dirname(filePath);
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    await fs.writeFile(tempPath, content, { mode });
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

type NormalizedFile = { logicalPath: string; content: string };

/**
 * Validate the bundle's files: each path normalizes through the widget jail
 * (rejects traversal / absolute / control chars), carries a servable extension, and
 * is a string; the decoded total stays under the size cap. Returns the normalized
 * file list. Throws on the first violation.
 */
function validateBundleFiles(files: unknown): NormalizedFile[] {
  if (!isRecord(files)) {
    throw new Error("bundle files must be an object");
  }
  const entries = Object.entries(files);
  if (entries.length === 0) {
    throw new Error("bundle contains no files");
  }
  if (entries.length > WIDGET_BUNDLE_MAX_FILES) {
    throw new Error(`bundle must contain at most ${WIDGET_BUNDLE_MAX_FILES} files`);
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  const normalized: NormalizedFile[] = [];
  for (const [rawPath, content] of entries) {
    if (typeof content !== "string") {
      throw new Error(`bundle file content must be a string: ${rawPath}`);
    }
    let logicalPath: string;
    try {
      logicalPath = normalizeWidgetLogicalPath(rawPath);
    } catch {
      throw new Error(`bundle file path is invalid: ${rawPath}`);
    }
    if (!isServableWidgetFile(logicalPath)) {
      throw new Error(`bundle file type is not allowed: ${logicalPath}`);
    }
    if (seen.has(logicalPath)) {
      throw new Error(`bundle contains a duplicate file path: ${logicalPath}`);
    }
    seen.add(logicalPath);
    totalBytes += Buffer.byteLength(content, "utf8");
    if (totalBytes > WIDGET_BUNDLE_MAX_BYTES) {
      throw new Error("widget bundle exceeds 512 KB");
    }
    normalized.push({ logicalPath, content });
  }
  return normalized;
}

/**
 * Install a client-fetched widget bundle: validate size + manifest + file paths,
 * write the files under the widget's own dir, then register the widget as `pending`.
 * All validation happens BEFORE the registry write, and the registry write is
 * `pending` only — never `approved`.
 */
export async function installWidgetBundle(
  store: DashboardStore,
  input: WidgetBundleInput,
  options: InstallWidgetOptions,
): Promise<{ doc: WorkspaceDoc }> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!CUSTOM_WIDGET_NAME_PATTERN.test(name)) {
    throw new Error("widget name is invalid");
  }
  // Files first so an oversize/invalid bundle is rejected before any manifest work.
  const files = validateBundleFiles(input.files);
  // Manifest validation reuses the shared custom-widget validator (name must match,
  // entrypoint jailed, bindings/capabilities checked). Serialized here so the
  // on-disk widget.json is the canonical, re-validated manifest — never a
  // client-supplied file we did not check.
  const manifest = validateWidgetManifest(input.manifest, name);
  if (!files.some((file) => file.logicalPath === manifest.entrypoint)) {
    throw new Error("bundle is missing its entrypoint file");
  }

  const stateDir = options.stateDir ?? new FsStorageAdapter().storageDir();
  const widgetDir = resolveWidgetDir(name, stateDir);
  // Refuse to overwrite: a name already on disk (approved or orphaned) is never
  // clobbered by an install, so an install cannot swap an approved widget's code.
  await fs.mkdir(path.dirname(widgetDir), { recursive: true, mode: 0o700 });
  try {
    await fs.mkdir(widgetDir, { mode: 0o700 });
  } catch (error) {
    if (isErrnoException(error) && error.code === "EEXIST") {
      throw new Error("widget already exists", { cause: error });
    }
    throw error;
  }

  try {
    // Write the canonical manifest plus every bundle file, each atomically and
    // containment-checked against the widget's own dir.
    const toWrite: NormalizedFile[] = [
      { logicalPath: "widget.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
      ...files.filter((file) => file.logicalPath !== "widget.json"),
    ];
    for (const file of toWrite) {
      const target = path.resolve(widgetDir, file.logicalPath);
      if (target !== widgetDir && !target.startsWith(`${widgetDir}${path.sep}`)) {
        throw new Error(`bundle file escapes the widget dir: ${file.logicalPath}`);
      }
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFileAtomic(target, file.content, 0o600);
    }

    // Registry write LAST, and `pending` only — the approval gate stands here.
    const result = await store.mutate(
      (draft) => {
        if (draft.widgetsRegistry[name]) {
          throw new Error("widget already exists");
        }
        draft.widgetsRegistry[name] = { status: "pending", createdBy: options.actor };
      },
      { actor: options.actor },
    );
    return { doc: result.doc };
  } catch (error) {
    // Clean up the just-written files so a failed install leaves no orphan dir.
    await fs.rm(widgetDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
