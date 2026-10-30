// The star calendar's maths (journal brief §1): the month grid (Mon–Sun) and the streak line.

import { addDays, endOfMonth, weekdayOf } from "../domain/dates";
import type { ISODate } from "../domain/types";

/** One cell of the month grid: a blank before the 1st, or a day. */
export type CalendarCell = { blank: true } | { blank: false; date: ISODate; day: number };

/** "2026-10" -> the month's cells, Monday first, blanks before the 1st. */
export function monthGrid(month: string): CalendarCell[] {
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const lead = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(weekdayOf(first));
  const last = Number(endOfMonth(y!, m!).slice(8));
  const cells: CalendarCell[] = Array.from({ length: lead }, () => ({ blank: true as const }));
  for (let d = 1; d <= last; d++) cells.push({ blank: false, date: addDays(first, d - 1), day: d });
  return cells;
}

/** The month before or after "YYYY-MM". */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y! * 12 + (m! - 1) + by;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/**
 * Days in a row: counted back from today, or from yesterday when today isn't done yet (so
 * the morning before she writes still shows her run). 0 when neither is done.
 */
export function daysInARow(done: ReadonlySet<ISODate>, today: ISODate): number {
  let day = done.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (done.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

/** Done days in "YYYY-MM". */
export function doneInMonth(done: ReadonlySet<ISODate>, month: string): number {
  let n = 0;
  for (const d of done) if (d.startsWith(`${month}-`)) n++;
  return n;
}

/**
 * The streak line: "N days in a row · M this month". The "in a row" part is left out when it
 * is 0 (never a broken-streak message); null when there is nothing to say at all.
 */
export function streakLine(done: ReadonlySet<ISODate>, today: ISODate): string | null {
  const row = daysInARow(done, today);
  const month = doneInMonth(done, today.slice(0, 7));
  const parts: string[] = [];
  if (row > 0) parts.push(row === 1 ? "1 day in a row" : `${row} days in a row`);
  if (month > 0) parts.push(`${month} this month`);
  return parts.length ? parts.join(" · ") : null;
}
