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

/** Keeps `fill` as today's picks in this device's row (added to what it kept today already). */
export async function recordTodayFill(today: ISODate, fill: TodayFill): Promise<void> {
  const deviceId = await getDeviceId(db);
  const id = todayFillRowId(deviceId);
  await db.transaction("rw", db.prefs, async () => {
    const stored = await db.prefs.get(id);
    const same = validTodayFillRow(stored) && stored.date === today ? stored : undefined;
    const ids = [...new Set([...(same?.ids ?? []), ...fill.ids])].slice(0, MAX_FILL_IDS);
    if (same && ids.length === same.ids.length) return; // nothing new
    await db.prefs.put(todayFillRow(deviceId, today, ids, same?.room ?? fill.room));
  });
}
