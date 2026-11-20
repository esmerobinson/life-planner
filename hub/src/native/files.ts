// The Mac app's file bridge for "What I did" (mac/Esmeworld/main.swift, FilesBridge,
// "esmeworldFiles"). On the Mac, Attach files opens the Mac's own file picker and COPIES each
// chosen file (never moves or deletes it) into `<root>/<Area>` or `<root>/<Area>/<Project>`,
// making the folders when missing and never overwriting (" (2)" and so on). Only the saved names
// and folders come back; no file contents ever reach the page. In a browser or on the iPhone
// there is no bridge: every call here is a no-op.

import { DEFAULT_FILES_ROOT, safeName } from "../domain/whatIDid";
import type { DidFile } from "../domain/types";

export const FILES_HANDLER = "esmeworldFiles";
/** The largest photo the Mac app copies into her folder (mac/Esmeworld/main.swift maxPhotoBytes). */
export const MAX_PHOTO_COPY_BYTES = 100_000_000;

interface ReplyHandler {
  postMessage(message: unknown): Promise<unknown>;
}

function handler(): ReplyHandler | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { webkit?: { messageHandlers?: Record<string, ReplyHandler | undefined> } };
  return w.webkit?.messageHandlers?.[FILES_HANDLER] ?? null;
}

/** True inside a Mac app that can keep files. */
export function hasFileBridge(): boolean {
  return handler() !== null;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export type AttachResult =
  | { kind: "saved"; files: DidFile[]; failed: number }
  | { kind: "cancelled" }
  /** macOS did not let Esmeworld write there (Privacy & Security, Files and Folders). */
  | { kind: "permission" }
  | { kind: "error" }
  | { kind: "unavailable" };

/** Opens the Mac's file picker and copies what she chooses into the area's (or project's) folder. */
export async function attachFiles(to: { root: string; area: string; project?: string }): Promise<AttachResult> {
  const h = handler();
  if (!h) return { kind: "unavailable" };
  let reply: unknown;
  try {
    reply = await h.postMessage({
      action: "attach",
      root: to.root,
      parts: [safeName(to.area), ...(to.project !== undefined ? [safeName(to.project)] : [])],
    });
  } catch {
    return { kind: "error" };
  }
  return savedReply(reply);
}

/** The bridge's answer to attach or savePhoto. */
function savedReply(reply: unknown): AttachResult {
  const r = obj(reply);
  if (!r) return { kind: "error" };
  if (r.cancelled === true) return { kind: "cancelled" };
  if (r.error === "permission") return { kind: "permission" };
  if (r.error !== undefined) return { kind: "error" };
  const saved = Array.isArray(r.saved) ? r.saved : [];
  const files = saved.flatMap((f) => {
    const o = obj(f);
    return o && typeof o.name === "string" && o.name && typeof o.folder === "string" && o.folder
      ? [{ name: o.name, folder: o.folder }]
      : [];
  });
  const failed = (Array.isArray(r.failed) ? r.failed.length : 0) + (saved.length - files.length);
  if (files.length === 0 && failed === 0) return { kind: "cancelled" };
  return { kind: "saved", files, failed };
}

const PHOTO_EXT = /\.(jpe?g|png|hei[cf]|gif|webp|tiff?)$/i;
const EXT_OF: Record<string, string> = {
  "image/png": "png", "image/heic": "heic", "image/heif": "heif", "image/gif": "gif", "image/webp": "webp", "image/tiff": "tiff",
};

/** A safe file name for a photo that ends in a photo's extension (from its type; else .jpg). */
export function photoFileName(name: string, type: string): string {
  const base = name.trim() ? safeName(name) : "Photo";
  return PHOTO_EXT.test(base) ? base : `${base}.${EXT_OF[type] ?? "jpg"}`;
}

/**
 * A photo added to a "What I did" note on the Mac (Esme, 19 Nov 2026): its own bytes (base64, as
 * chosen, not the downscaled copy) are saved into the area's (or project's) folder like an
 * attached file, never overwriting. An older Mac app without `savePhoto` counts as "unavailable".
 */
export async function savePhotoCopy(to: {
  root: string; area: string; project?: string; name: string; data: string;
  /** The photo's type, for its extension when the name has none. */
  type?: string;
}): Promise<AttachResult> {
  const h = handler();
  if (!h) return { kind: "unavailable" };
  try {
    return savedReply(
      await h.postMessage({
        action: "savePhoto",
        root: to.root,
        parts: [safeName(to.area), ...(to.project !== undefined ? [safeName(to.project)] : [])],
        name: photoFileName(to.name, to.type ?? ""),
        data: to.data,
      }),
    );
  } catch (e) {
    // A Mac app older than this page has no savePhoto: as if there were no bridge (review M8).
    return /unknown action/.test(String((e as Error)?.message ?? e)) ? { kind: "unavailable" } : { kind: "error" };
  }
}

/** The Mac's folder picker, for the folder setting. Null when cancelled or not on the Mac. */
export async function chooseFilesRoot(): Promise<string | null> {
  const h = handler();
  if (!h) return null;
  try {
    const r = obj(await h.postMessage({ action: "chooseRoot" }));
    return r && typeof r.root === "string" && r.root ? r.root : null;
  } catch {
    return null;
  }
}

/** Shows a kept file in Finder. "missing" when it has been moved or deleted since. */
export async function revealFile(f: DidFile): Promise<"ok" | "missing" | "error" | "unavailable"> {
  const h = handler();
  if (!h) return "unavailable";
  try {
    const r = obj(await h.postMessage({ action: "reveal", folder: f.folder, name: f.name }));
    if (r?.ok === true) return "ok";
    return r?.missing === true ? "missing" : "error";
  } catch {
    return "error";
  }
}

/**
 * Where kept files go: the Mac app's own setting (review M1: it only takes a folder she chose in
 * its folder picker, and refuses any other root the page sends). "~/Desktop" elsewhere.
 */
export async function loadFilesRoot(): Promise<string> {
  const h = handler();
  if (!h) return DEFAULT_FILES_ROOT;
  try {
    const r = obj(await h.postMessage({ action: "getRoot" }));
    return r && typeof r.root === "string" && r.root ? r.root : DEFAULT_FILES_ROOT;
  } catch {
    return DEFAULT_FILES_ROOT;
  }
}

/** Back to the Desktop (the Mac app's default). Returns the folder now in use. */
export async function resetFilesRoot(): Promise<string> {
  const h = handler();
  if (!h) return DEFAULT_FILES_ROOT;
  try {
    const r = obj(await h.postMessage({ action: "resetRoot" }));
    return r && typeof r.root === "string" && r.root ? r.root : DEFAULT_FILES_ROOT;
  } catch {
    return DEFAULT_FILES_ROOT;
  }
}
