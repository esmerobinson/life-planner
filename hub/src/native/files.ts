// The Mac app's file bridge for "What I did" (mac/Esmeworld/main.swift, FilesBridge,
// "esmeworldFiles"). On the Mac, Attach files opens the Mac's own file picker and COPIES each
// chosen file (never moves or deletes it) into `<root>/<Area>` or `<root>/<Area>/<Project>`,
// making the folders when missing and never overwriting (" (2)" and so on). Only the saved names
// and folders come back; no file contents ever reach the page. In a browser or on the iPhone
// there is no bridge: every call here is a no-op.

import { db } from "../data/db";
import { DEFAULT_FILES_ROOT, safeName } from "../domain/whatIDid";
import type { DidFile } from "../domain/types";

export const FILES_HANDLER = "esmeworldFiles";
/** This device's folder for kept files (syncMeta: never synced, never in a backup). */
export const FILES_ROOT_KEY = "whatIDidRoot";

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

/** This device's folder for kept files ("~/Desktop" until she chooses another). */
export async function loadFilesRoot(): Promise<string> {
  const v = (await db.syncMeta.get(FILES_ROOT_KEY))?.value;
  return typeof v === "string" && v.trim() ? v : DEFAULT_FILES_ROOT;
}

export async function saveFilesRoot(root: string): Promise<void> {
  await db.syncMeta.put({ key: FILES_ROOT_KEY, value: root });
}
