// Today's list stops refilling (Esme, 2026-11-06: removing a task from Today "just constantly
// gets replaced with another"). Pure rules: no database import, so the change tracker and the
// sync engine can use the row check without a cycle.
//
// The first time Home works out Today's list on a day, the picks it chose to fill the list
// (things due in the next few days, then priority 1, then the priority 2 rotation; never the
// pins or what is due today, which always show) are kept in the synced `prefs` table:
//
//   today-fill:<deviceId>   { date, ids, room }
//     `ids`: the picks that filled the list; `room`: how many places there were to fill.
//     One row per device, written over the next day, so two devices that both pick before they
//     sync never overwrite each other: today's rows from every device count together.
//
// For the rest of that day the list keeps those picks: one she removes, moves, deletes or ticks
// off is never replaced, so the list just gets shorter. A place that was never filled (too few
// to-dos that morning) can still take a new one. The next day (3am) starts fresh.

import { isValidISODate } from "./dates";
import type { ISODate } from "./types";

export const TODAY_FILL_PREFIX = "today-fill:";
/** More than Today ever picks (4 a day); a cap so a broken row can't grow without end. */
export const MAX_FILL_IDS = 50;
const MAX_ID = 128;
const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface TodayFillRow {
  id: string;
  date: ISODate;
  ids: string[];
  room: number;
  /** Sync stamp, set on every write by the change tracker. */
  updatedAt?: number;
}

/** The day's frozen picks: what filled the list, and how many places there were. */
export interface TodayFill {
  ids: string[];
  room: number;
}

export const todayFillRowId = (deviceId: string): string => `${TODAY_FILL_PREFIX}${deviceId}`;

export const isTodayFillRowId = (id: unknown): boolean => typeof id === "string" && id.startsWith(TODAY_FILL_PREFIX);

export function todayFillRow(deviceId: string, date: ISODate, ids: string[], room: number): TodayFillRow {
  return { id: todayFillRowId(deviceId), date, ids, room };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && v !== "" && v.length <= MAX_ID;

/** One today-fill row is well formed (sync, local writes). Unknown fields are allowed (later versions). */
export function validTodayFillRow(r: unknown): r is TodayFillRow {
  if (!isObj(r) || typeof r.id !== "string" || !r.id.startsWith(TODAY_FILL_PREFIX)) return false;
  if (!DEVICE_ID.test(r.id.slice(TODAY_FILL_PREFIX.length))) return false;
  if (r.updatedAt !== undefined && !(typeof r.updatedAt === "number" && Number.isSafeInteger(r.updatedAt) && r.updatedAt >= 0)) return false;
  if (typeof r.date !== "string" || !isValidISODate(r.date)) return false;
  if (!Array.isArray(r.ids) || r.ids.length > MAX_FILL_IDS || !r.ids.every(isId)) return false;
  return typeof r.room === "number" && Number.isInteger(r.room) && r.room >= 0 && r.room <= MAX_FILL_IDS;
}

/**
 * Today's frozen picks from every device's row for `today` (their ids together, in row order;
 * the most room any of them had), or undefined when no device has picked today yet.
 */
export function frozenFill(rows: readonly unknown[], today: ISODate): TodayFill | undefined {
  const mine = rows
    .filter((r): r is TodayFillRow => validTodayFillRow(r) && r.date === today)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (mine.length === 0) return undefined;
  const ids = [...new Set(mine.flatMap((r) => r.ids))];
  return { ids, room: Math.max(...mine.map((r) => r.room)) };
}
