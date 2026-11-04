import type { ISODate, Weekday } from "./types";

const DAY_MS = 86_400_000;
const WEEKDAYS: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function toUTC(d: ISODate): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

function fromUTC(ms: number): ISODate {
  const dt = new Date(ms);
  const y = String(dt.getUTCFullYear()).padStart(4, "0");
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromUTC(toUTC(d) + n * DAY_MS);
}

/** b minus a, in days. */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
}

export function mondayOf(d: ISODate): ISODate {
  const dow = new Date(toUTC(d)).getUTCDay(); // 0 = Sunday
  return addDays(d, -((dow + 6) % 7));
}

export function monthOf(d: ISODate): string {
  return d.slice(0, 7);
}

export function weekdayOf(d: ISODate): Weekday {
  return WEEKDAYS[new Date(toUTC(d)).getUTCDay()];
}

/**
 * Esme's day ends at 3am (her choice, 2026-11-04): anything done before 3am still counts as the
 * previous day (a 1am exercise is yesterday's). Every "today" in the app comes from here.
 */
export const DAY_ENDS_AT_HOUR = 3;

/** Today's local date, where a day runs from 3am to 3am (see DAY_ENDS_AT_HOUR). */
export function todayISO(at: Date = new Date()): ISODate {
  const shifted = new Date(at.getTime());
  shifted.setHours(shifted.getHours() - DAY_ENDS_AT_HOUR);
  return fromUTC(Date.UTC(shifted.getFullYear(), shifted.getMonth(), shifted.getDate()));
}

/** Last calendar day of a month (month is 1 to 12). No local-timezone conversion. */
export function endOfMonth(year: number, month: number): ISODate {
  return fromUTC(Date.UTC(year, month, 0));
}

export function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return fromUTC(toUTC(s)) === s;
}
