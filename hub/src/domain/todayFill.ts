// Today's list stops refilling (Esme, 2026-11-06: removing a task from Today "just constantly
// gets replaced with another"; 2026-11-18: ticking off must not bring a new one in either).
// Pure rules: no database import, so the change tracker and the sync engine can use the row
// check without a cycle.
//
// Once a device has had its first sync of the day (data/todayFillRepo.ts), Home keeps the
// picks that filled Today's list (things due in the next few days, then priority 1, then the
// priority 2 rotation; never the pins or what is due today, which always show) in ONE shared
// row for the day, in the synced `prefs` table:
//
//   today-fill:<date>   { date, ids, room, dues?, pickedAt }
//     `ids`: the picks (never more than `room`); `room`: how many places there were to fill,
//     0 on a day already full of things due (fix round 1, I1); `dues`: a pick's due date when
//     it was picked (a deadline pushed out later takes it off Today, M1); `pickedAt`: when.
//
// The FIRST picks of the day win everywhere (fix round 1, I3): the row's sync stamp counts
// DOWN from a point before the day (firstWinsStamp), so an earlier pick always beats a later
// one under last-write-wins, and no stamp is ever in the future. A device that picked later
// takes the earlier list, unless she has already used Today there that day: then it keeps the
// list she has been working from (its own copy, OwnFill, in this device's syncMeta).
//
// For the rest of the day the list keeps those picks: one she removes, moves, deletes or ticks
// off is never replaced, so the list just gets shorter. A place never filled (too few to-dos
// that morning) can still take a new one, which is kept too. The next day (3am) starts fresh.

import { isValidISODate } from "./dates";
import type { ISODate } from "./types";

export const TODAY_FILL_PREFIX = "today-fill:";
/** More than Today ever picks (4 a day); a cap so a broken row can't grow without end. */
export const MAX_FILL_IDS = 50;
/** Rows for days older than this are removed from this device (data/todayFillRepo.ts). */
export const PRUNE_AFTER_DAYS = 14;
const MAX_ID = 128;
const DAY_MS = 86_400_000;

/** The day's kept picks: what filled the list, how many places there were, picks' due dates. */
export interface TodayFill {
  ids: string[];
  room: number;
  dues?: Record<string, ISODate>;
}

export interface TodayFillRow extends TodayFill {
  id: string;
  date: ISODate;
  /** When the day's picks were first kept (epoch ms). */
  pickedAt: number;
  /** Sync stamp: firstWinsStamp, never "now". */
  updatedAt?: number;
}

/** This device's own copy of the list it shows (syncMeta, never synced). */
export interface OwnFill extends TodayFill {
  date: ISODate;
  /** She has ticked, moved or removed something on Today here today. */
  touched: boolean;
  /**
   * Picked while offline before the day's full sync (re-review R-I1): not the day's shared row
   * yet. Published after that sync only if no other device's row has arrived by then.
   */
  unpublished?: true;
}

export const todayFillRowId = (date: ISODate): string => `${TODAY_FILL_PREFIX}${date}`;

export const isTodayFillRowId = (id: unknown): boolean => typeof id === "string" && id.startsWith(TODAY_FILL_PREFIX);

export function todayFillRow(date: ISODate, fill: TodayFill, pickedAt: number): TodayFillRow {
  return { id: todayFillRowId(date), date, ids: fill.ids, room: fill.room, ...(fill.dues ? { dues: fill.dues } : {}), pickedAt };
}

/**
 * The row's sync stamp: counts down from the start of the UTC day before `date` (before her
 * day starts in any time zone), so the earliest pick has the largest stamp and wins under
 * last-write-wins, and it is never in the future. `version` (how many picks it holds) puts
 * a device's own later additions just above its earlier copy.
 */
export function firstWinsStamp(date: ISODate, pickedAt: number, version: number): number {
  const [y, m, d] = date.split("-").map(Number);
  const anchor = Date.UTC(y!, m! - 1, d!) - DAY_MS;
  const down = 2 * anchor - Math.max(pickedAt, anchor); // never above the anchor
  return Math.max(1, down + version);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && v !== "" && v.length <= MAX_ID;

function validFill(r: Record<string, unknown>): boolean {
  if (!Array.isArray(r.ids) || r.ids.length > MAX_FILL_IDS || !r.ids.every(isId)) return false;
  if (!(typeof r.room === "number" && Number.isInteger(r.room) && r.room >= 0 && r.room <= MAX_FILL_IDS)) return false;
  if (r.ids.length > r.room) return false; // never more picks than places (M2)
  if (r.dues !== undefined) {
    if (!isObj(r.dues)) return false;
    const ids = new Set(r.ids as string[]);
    for (const [k, v] of Object.entries(r.dues)) if (!ids.has(k) || typeof v !== "string" || !isValidISODate(v)) return false;
  }
  return true;
}

/** One today-fill row is well formed (sync, local writes). Unknown fields are allowed (later versions). */
export function validTodayFillRow(r: unknown): r is TodayFillRow {
  if (!isObj(r) || typeof r.id !== "string" || typeof r.date !== "string" || !isValidISODate(r.date)) return false;
  if (r.id !== todayFillRowId(r.date)) return false;
  if (r.updatedAt !== undefined && !(typeof r.updatedAt === "number" && Number.isSafeInteger(r.updatedAt) && r.updatedAt >= 0)) return false;
  if (!(typeof r.pickedAt === "number" && Number.isSafeInteger(r.pickedAt) && r.pickedAt > 0)) return false;
  return validFill(r);
}

/** This device's own copy is well formed. */
export function validOwnFill(r: unknown): r is OwnFill {
  if (!isObj(r) || typeof r.date !== "string" || !isValidISODate(r.date) || typeof r.touched !== "boolean") return false;
  return (r.unpublished === undefined || r.unpublished === true) && validFill(r);
}

const fillOf = (f: TodayFill): TodayFill => ({ ids: f.ids, room: f.room, ...(f.dues ? { dues: f.dues } : {}) });

/**
 * The kept picks this device shows today: its own copy once she has used Today here (so a row
 * from a device that picked earlier never changes a list she is working from), else the day's
 * shared row, else its own copy; undefined when there are none for today yet.
 */
export function effectiveFill(shared: unknown, own: unknown, today: ISODate): TodayFill | undefined {
  const s = validTodayFillRow(shared) && shared.date === today ? shared : undefined;
  const o = validOwnFill(own) && own.date === today ? own : undefined;
  if (o?.touched) return fillOf(o);
  if (s) return fillOf(s);
  return o ? fillOf(o) : undefined;
}
