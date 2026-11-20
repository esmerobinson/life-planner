// A removed photo is really deleted (review I1, 20 Nov 2026). When a picture line leaves a page,
// or Remove takes a photo off a "What I did" note, the photo's id is noted here (this device only,
// in syncMeta, which never syncs) with when. After a short grace period, and when the Bin is
// emptied, every noted photo that nothing shows any more (no page and no note, on any to-do,
// idea or goal, the Bin included) becomes the content-free "purged" tombstone that sync already
// carries to every device and server. A photo still shown somewhere, or put back meanwhile, is
// kept and its note dropped. Journal photos (sealed) are never touched.

import { db } from "./db";
import { shownPictureIds } from "../domain/page";
import type { FileRow } from "../domain/types";

/** How long a removed photo is kept before it is deleted: room to put it back (an undo, another device). */
export const PHOTO_PURGE_GRACE_MS = 30_000;
const KEY = "removedPhotos";
/** The most removals remembered (the oldest go first; a sweep normally empties the list). */
const MAX_NOTED = 500;

interface Removed {
  id: string;
  /** The to-do, idea or goal it was taken off. */
  row: string;
  /** When (epoch ms). */
  at: number;
}

async function noted(): Promise<Removed[]> {
  const v = (await db.syncMeta.get(KEY))?.value;
  return Array.isArray(v) ? (v as Removed[]) : [];
}

/** Notes photos taken off a row. Inside the caller's transaction, which must include syncMeta. */
export async function noteRemovedPhotos(row: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const at = Date.now();
  const list = (await noted()).filter((r) => !ids.includes(r.id));
  for (const id of new Set(ids)) list.push({ id, row, at });
  await db.syncMeta.put({ key: KEY, value: list.slice(-MAX_NOTED) });
  schedulePhotoSweep();
}

/**
 * Deletes the noted photos that are due (past the grace period, or taken off one of `rows`), unless
 * something still shows them; `extra` are more photo ids to check (a binned row's removed ones).
 * Inside a transaction over items, goals, files and syncMeta. Returns how many were deleted.
 */
export async function sweepIn(now: number, rows: ReadonlySet<string> = new Set(), extra: readonly string[] = []): Promise<number> {
  const list = await noted();
  const due = list.filter((r) => r.at + PHOTO_PURGE_GRACE_MS <= now || rows.has(r.row));
  const ids = new Set([...due.map((r) => r.id), ...extra]);
  if (due.length) await db.syncMeta.put({ key: KEY, value: list.filter((r) => !due.includes(r)) });
  if (ids.size === 0) return 0;
  const shown = new Set<string>();
  await db.items.each((i) => shownPictureIds(i).forEach((id) => shown.add(id)));
  await db.goals.each((g) => shownPictureIds(g).forEach((id) => shown.add(id)));
  const tombs: FileRow[] = [];
  for (const id of ids) {
    if (shown.has(id)) continue;
    const f = await db.files.get(id);
    if (!f || f.status === "purged" || f.encrypted === true) continue;
    tombs.push({ id, mime: f.mime, data: "", width: 0, height: 0, createdAt: f.createdAt, status: "purged" });
  }
  if (tombs.length) await db.files.bulkPut(tombs);
  return tombs.length;
}

/** Deletes every noted photo whose grace period is over and that nothing shows any more. */
export async function sweepRemovedPhotos(now = Date.now()): Promise<number> {
  return db.transaction("rw", db.items, db.goals, db.files, db.syncMeta, () => sweepIn(now));
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** A sweep once the newest removal's grace period is over (and at every app start, AppShell). */
export function schedulePhotoSweep(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void sweepRemovedPhotos().catch(() => undefined); // tried again at the next start
  }, PHOTO_PURGE_GRACE_MS + 1_000);
}
