// Today's picks, kept for the day (domain/todayFill.ts): the day's ONE shared synced row, and
// this device's own copy of the list it shows (syncMeta, never synced, never in a backup).

import { db, type HubDB } from "./db";
import { keepOwnStamps } from "./changeTracking";
import { addDays } from "../domain/dates";
import {
  MAX_FILL_IDS, PRUNE_AFTER_DAYS, TODAY_FILL_PREFIX, firstWinsStamp, todayFillRow, todayFillRowId, validOwnFill,
  validTodayFillRow, type OwnFill, type TodayFill,
} from "../domain/todayFill";
import type { ISODate } from "../domain/types";

/** This device's copy of the list it shows today (syncMeta key). */
export const OWN_FILL_META = "todayFillOwn";

/**
 * Whether Home should keep `next` (todayFill's answer) over what is kept (`frozen`): always the
 * day's first picks, even none at all (a day full of things due keeps "no places", so ticking
 * one off pulls nothing in: fix round 1, I1); after that only a pick that took a place never filled.
 */
export function shouldRecord(frozen: TodayFill | undefined, next: TodayFill): boolean {
  if (!frozen) return true;
  const kept = new Set(frozen.ids);
  return next.ids.some((id) => !kept.has(id));
}

/** `base` with `fill`'s new picks added, never past `room` places. */
function grow(base: TodayFill, fill: TodayFill, room: number): TodayFill {
  const ids = [...base.ids];
  const dues = { ...base.dues };
  for (const x of fill.ids) {
    if (ids.includes(x) || ids.length >= Math.min(room, MAX_FILL_IDS)) continue;
    ids.push(x);
    const due = fill.dues?.[x];
    if (due) dues[x] = due;
  }
  return { ids, room, ...(Object.keys(dues).length > 0 ? { dues } : {}) };
}

const ownOf = (date: ISODate, f: TodayFill, touched: boolean): OwnFill => ({ date, ...f, touched });

/**
 * Keeps `fill` as today's picks. No row for today yet: this device's picks become the day's
 * shared row (stamped so the first picks of the day win on every device: I3). A row already
 * here (picked here or on another device): a place never filled is filled into it, never past
 * its places. Once she has used Today on this device and an earlier device's row has replaced
 * the list she was working from, a place filled here goes into this device's copy only.
 */
export async function recordTodayFill(today: ISODate, fill: TodayFill, now = Date.now(), d: HubDB = db): Promise<void> {
  const id = todayFillRowId(today);
  await d.transaction("rw", [d.prefs, d.syncMeta], async () => {
    const stored = await d.prefs.get(id);
    const shared = validTodayFillRow(stored) && stored.date === today ? stored : undefined;
    const ownRow = (await d.syncMeta.get(OWN_FILL_META))?.value;
    const own = validOwnFill(ownRow) && ownRow.date === today ? ownRow : undefined;

    if (own?.touched && (!shared || own.ids.join() !== shared.ids.join() || own.room !== shared.room)) {
      const next = grow(own, fill, own.room);
      if (next.ids.length > own.ids.length) await d.syncMeta.put({ key: OWN_FILL_META, value: ownOf(today, next, true) });
      return;
    }
    const base: TodayFill = shared ?? { ids: [], room: fill.room };
    const next = grow(base, fill, base.room);
    if (shared && next.ids.length === shared.ids.length) return; // nothing new
    const pickedAt = shared?.pickedAt ?? now;
    keepOwnStamps(); // the first-wins stamp, not "now" (domain/todayFill.ts)
    await d.prefs.put({ ...todayFillRow(today, next, pickedAt), updatedAt: firstWinsStamp(today, pickedAt, next.ids.length) });
    await d.syncMeta.put({ key: OWN_FILL_META, value: ownOf(today, next, own?.touched ?? false) });
  });
}

/**
 * She has ticked, moved or removed something on Today here: the list she is working from
 * (`fill`, what this device shows) is kept as this device's copy for the rest of the day, so a
 * row from a device that picked earlier never changes it (I3). Once a day; nothing when there
 * are no kept picks yet.
 */
export async function markTodayTouched(today: ISODate, fill: TodayFill | undefined, d: HubDB = db): Promise<void> {
  if (!fill) return;
  await d.transaction("rw", d.syncMeta, async () => {
    const ownRow = (await d.syncMeta.get(OWN_FILL_META))?.value;
    if (validOwnFill(ownRow) && ownRow.date === today && ownRow.touched) return;
    await d.syncMeta.put({ key: OWN_FILL_META, value: ownOf(today, fill, true) });
  });
}

/** Removes this device's rows for days more than PRUNE_AFTER_DAYS ago (and anything waiting to send them). */
export async function pruneTodayFill(today: ISODate): Promise<void> {
  const oldest = todayFillRowId(addDays(today, -PRUNE_AFTER_DAYS));
  await db.transaction("rw", [db.prefs, db.pending], async () => {
    const old = await db.prefs.where("id").between(TODAY_FILL_PREFIX, oldest).primaryKeys();
    if (old.length === 0) return;
    await db.prefs.bulkDelete(old);
    await db.pending.bulkDelete(old.map((k) => ["prefs", k] as [string, string]));
  });
}

// ---- I2: wait for this session's first sync of the day ------------------------------------

const daysSeen = new Map<ISODate, number>();

/** When this app session first saw `today` (the day began here then: at start, or at 3am). */
export function daySeenAt(today: ISODate, now = Date.now()): number {
  let at = daysSeen.get(today);
  if (at === undefined) daysSeen.set(today, (at = now));
  return at;
}

/** Tests only: a fresh app session. */
export function forgetDaysSeen(): void {
  daysSeen.clear();
}

/**
 * Whether today's picks may be kept now (fix round 1, I2): with sync off, or offline, at once;
 * with sync on, only once a sync with the full pull done has finished after the day began in
 * this app session, so the picks come from her other device's latest, not last night's copy.
 * (The same "synced this session" signal the routine's suggested links wait for.)
 */
export function syncGateOpen(s: { token: boolean; firstPull: boolean; lastSyncedAt: number | undefined; online: boolean; daySeen: number }): boolean {
  if (!s.token || !s.online) return true;
  return s.firstPull && typeof s.lastSyncedAt === "number" && s.lastSyncedAt >= s.daySeen;
}
