// A removed photo is really deleted (review I1, 20 Nov 2026). When a picture line leaves a page,
// or Remove takes a photo off a "What I did" note, the photo's id is noted here (this device only,
// in syncMeta, which never syncs) with when. After a short grace period, and when the Bin is
// emptied, every noted photo that nothing shows any more (no page and no note, on any to-do,
// idea or goal, the Bin included) becomes the content-free "purged" tombstone that sync already
// carries to every device and server. A photo still shown somewhere, or put back meanwhile, is
// kept and its note dropped. Journal photos (sealed) are never touched.
//
// Re-review (20 Nov 2026): only removals made in the editor count (RI1, repo.ts saveItemNotes), and
// with sync set up nothing is deleted until this app session's whole pull has finished (RM1): a
// device that hasn't caught up may not see the page that still shows a photo. Until then the noted
// removals wait, Empty Bin's photos included.

import { db, type HubDB } from "./db";
import { SESSION_STARTED_AT } from "./session";
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

async function noted(d: HubDB = db): Promise<Removed[]> {
  const v = (await d.syncMeta.get(KEY))?.value;
  return Array.isArray(v) ? (v as Removed[]) : [];
}

/**
 * Notes photos taken off a row. Inside the caller's transaction, which must include syncMeta.
 * `at` 0: due at once (what Empty Bin couldn't delete yet).
 */
export async function noteRemovedPhotos(row: string, ids: readonly string[], d: HubDB = db, at = Date.now()): Promise<void> {
  if (ids.length === 0) return;
  const list = (await noted(d)).filter((r) => !ids.includes(r.id));
  for (const id of new Set(ids)) list.push({ id, row, at });
  await d.syncMeta.put({ key: KEY, value: list.slice(-MAX_NOTED) });
  schedulePhotoSweep();
}

/** Forgets every noted removal (a Replace restore: the rows they were checked against are gone, RM3). */
export async function forgetRemovedPhotos(d: HubDB = db): Promise<void> {
  await d.syncMeta.delete(KEY);
}

/**
 * Photos may be deleted now: sync is off, or this app session has had a sync whose whole pull
 * finished (RM1). Inside a transaction with syncMeta.
 */
export async function purgeAllowed(d: HubDB = db): Promise<boolean> {
  const [token, firstPull, last] = await Promise.all([d.syncMeta.get("token"), d.syncMeta.get("firstPullDone"), d.syncMeta.get("lastFullSyncAt")]);
  if (!token?.value) return true;
  return firstPull?.value === true && typeof last?.value === "number" && last.value >= SESSION_STARTED_AT;
}

/**
 * Empty Bin before the sync has finished: its rows' photos (and the removals noted on them) wait,
 * due at once, for the first sweep allowed. Inside a transaction with syncMeta.
 */
export async function deferBinPhotos(rows: ReadonlySet<string>, ids: readonly string[]): Promise<void> {
  const list = (await noted()).map((r) => (rows.has(r.row) ? { ...r, at: 0 } : r));
  const have = new Set(list.map((r) => r.id));
  for (const id of new Set(ids)) if (!have.has(id)) list.push({ id, row: "bin", at: 0 });
  await db.syncMeta.put({ key: KEY, value: list.slice(-MAX_NOTED) });
  schedulePhotoSweep();
}

/**
 * Sync applied to-dos whose notes list photos as removed (`didPhotosGone`) that are still stored
 * here: they are noted again, for a sweep after their grace period (re-review RM2). That catches a
 * photo put back by a device that hadn't seen the removal (its own row still showed it then). Inside
 * the engine's apply transaction.
 */
export async function noteGoneFromSync(d: HubDB, rows: readonly { id: string; didPhotosGone?: string[] }[]): Promise<void> {
  const add: Removed[] = [];
  const at = Date.now();
  for (const row of rows) {
    for (const id of row.didPhotosGone ?? []) {
      const f = await d.files.get(id);
      if (f && f.status !== "purged" && f.encrypted !== true && f.data !== "") add.push({ id, row: row.id, at });
    }
  }
  if (!add.length) return;
  const v = (await d.syncMeta.get(KEY))?.value;
  const list = (Array.isArray(v) ? (v as Removed[]) : []).filter((r) => !add.some((a) => a.id === r.id));
  await d.syncMeta.put({ key: KEY, value: [...list, ...add].slice(-MAX_NOTED) });
  schedulePhotoSweep();
}

/**
 * Deletes the noted photos that are due (past the grace period, or taken off one of `rows`), unless
 * something still shows them; `extra` are more photo ids to check (a binned row's removed ones).
 * Inside a transaction over items, goals, files and syncMeta. Returns how many were deleted.
 */
export async function sweepIn(
  now: number, rows: ReadonlySet<string> = new Set(), extra: readonly string[] = [], d: HubDB = db,
): Promise<number> {
  if (!(await purgeAllowed(d))) return 0; // everything stays noted until the sync has finished (RM1)
  const list = await noted(d);
  const due = list.filter((r) => r.at + PHOTO_PURGE_GRACE_MS <= now || rows.has(r.row));
  const ids = new Set([...due.map((r) => r.id), ...extra]);
  if (due.length) await d.syncMeta.put({ key: KEY, value: list.filter((r) => !due.includes(r)) });
  if (ids.size === 0) return 0;
  const shown = new Set<string>();
  await d.items.each((i) => shownPictureIds(i).forEach((id) => shown.add(id)));
  await d.goals.each((g) => shownPictureIds(g).forEach((id) => shown.add(id)));
  const tombs: FileRow[] = [];
  for (const id of ids) {
    if (shown.has(id)) continue;
    const f = await d.files.get(id);
    if (!f || f.status === "purged" || f.encrypted === true) continue;
    tombs.push({ id, mime: f.mime, data: "", width: 0, height: 0, createdAt: f.createdAt, status: "purged" });
  }
  if (tombs.length) await d.files.bulkPut(tombs);
  return tombs.length;
}

/** Deletes every noted photo whose grace period is over and that nothing shows any more. */
export async function sweepRemovedPhotos(now = Date.now(), d: HubDB = db): Promise<number> {
  return d.transaction("rw", d.items, d.goals, d.files, d.syncMeta, () => sweepIn(now, new Set(), [], d));
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** A sweep once the newest removal's grace period is over (and at every app start, AppShell). */
export function schedulePhotoSweep(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    // Again while any are left waiting (a later removal's grace period, or the sync not done yet).
    void sweepRemovedPhotos()
      .then(async () => {
        if ((await noted()).length) schedulePhotoSweep();
      })
      .catch(() => undefined); // tried again at the next start
  }, PHOTO_PURGE_GRACE_MS + 1_000);
}
