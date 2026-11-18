// Today's picks, kept for the day (domain/todayFill.ts): this device's own synced prefs row.
// Only this device writes its row, so last-write-wins never loses another device's picks.

import { db } from "./db";
import { MAX_FILL_IDS, todayFillRow, todayFillRowId, validTodayFillRow, type TodayFill } from "../domain/todayFill";
import type { ISODate } from "../domain/types";
import { getDeviceId } from "../sync/engine";

/**
 * Whether Home should record `next` (todayFill's answer) over what is kept (`frozen`): the day's
 * first picks (when there are any), or a pick that took a place never filled.
 */
export function shouldRecord(frozen: TodayFill | undefined, next: TodayFill): boolean {
  if (!frozen) return next.ids.length > 0;
  const kept = new Set(frozen.ids);
  return next.ids.some((id) => !kept.has(id));
}

/**
 * Keeps `fill` as today's picks in this device's row: added to what it kept today already, never
 * past the places there were that morning.
 */
export async function recordTodayFill(today: ISODate, fill: TodayFill): Promise<void> {
  const deviceId = await getDeviceId(db);
  const id = todayFillRowId(deviceId);
  await db.transaction("rw", db.prefs, async () => {
    const stored = await db.prefs.get(id);
    const same = validTodayFillRow(stored) && stored.date === today ? stored : undefined;
    // Never more picks than there were places: a record worked out from an older copy (to-dos
    // arriving while Home is open) adds only into places still free.
    const room = same?.room ?? fill.room;
    const ids = [...(same?.ids ?? [])];
    for (const x of fill.ids) if (!ids.includes(x) && ids.length < Math.min(room, MAX_FILL_IDS)) ids.push(x);
    if (same && ids.length === same.ids.length) return; // nothing new
    if (ids.length === 0) return;
    await db.prefs.put(todayFillRow(deviceId, today, ids, room));
  });
}
