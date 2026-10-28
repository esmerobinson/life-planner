import { addDays, daysBetween } from "./dates";
import type { ISODate, Item } from "./types";

export const DUE_SOON_DAYS = 3;
export const STALE_DAYS = 14;

/**
 * Open, sorted, non-recurring tasks that deserve a look: overdue, due within DUE_SOON_DAYS,
 * or untouched for STALE_DAYS. Inbox items (already under "To sort"), ideas, done, archived
 * and recurring items are never included. Each item lands in at most one group.
 */
export function needsALook(items: Item[], today: ISODate): { overdue: Item[]; dueSoon: Item[]; stale: Item[] } {
  const horizon = addDays(today, DUE_SOON_DAYS);
  const overdue: Item[] = [];
  const dueSoon: Item[] = [];
  const stale: Item[] = [];
  for (const it of items) {
    if (it.kind !== "task" || it.status !== "open" || it.areaId === "inbox" || it.recur) continue;
    if (it.due !== undefined && it.due < today) overdue.push(it);
    else if (it.due !== undefined && it.due <= horizon) dueSoon.push(it);
    else if (daysBetween(it.touchedAt, today) >= STALE_DAYS) stale.push(it);
  }
  overdue.sort((a, b) => a.due!.localeCompare(b.due!));
  dueSoon.sort((a, b) => a.due!.localeCompare(b.due!));
  stale.sort((a, b) => a.touchedAt.localeCompare(b.touchedAt));
  return { overdue, dueSoon, stale };
}
