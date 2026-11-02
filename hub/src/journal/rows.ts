// The Journal rows' maths (VISUAL-LANGUAGE.md "Journal rows (2026-11-02)"): for Morning pages,
// Daily check-in and Mental health exercise, whether it is done today (the tick, which only
// ever ticks itself) and the streak (the "★ N" on the right). Pure: every input comes from the
// journal repo's existing reads.

import type { ISODate } from "../domain/types";
import { addDays } from "../domain/dates";
import { daysInARow, doneInMonth } from "./calendar";
import type { ExerciseMark } from "./exercise";

/** One row's state: done today, and days in a row. */
export interface RowStatus {
  done: boolean;
  /** Days in a row ending today, or ending yesterday while today isn't done yet; 0 for none. */
  streak: number;
  /** The last seven days, oldest first, ending today: done or not (the streak's bars). */
  week: boolean[];
  /** Days done this month (the Mind habits' "session N of M"). */
  month: number;
}

/** The last seven days ending today, oldest first: whether each was done. */
export function lastSevenDays(doneDays: ReadonlySet<ISODate>, today: ISODate): boolean[] {
  return [6, 5, 4, 3, 2, 1, 0].map((back) => doneDays.has(addDays(today, -back)));
}

/** A row's tick, streak, week and month from the days it was done. */
export function rowStatus(doneDays: ReadonlySet<ISODate>, today: ISODate): RowStatus {
  return {
    done: doneDays.has(today),
    streak: daysInARow(doneDays, today),
    week: lastSevenDays(doneDays, today),
    month: doneInMonth(doneDays, today.slice(0, 7)),
  };
}

/** The shape of a check-in day this needs (journalRepo's CheckinDay). */
export interface CheckinDayLike {
  date: ISODate;
  prompts: string[];
  answers: ReadonlyMap<string, { done: boolean }>;
}

/**
 * Checked in: the day has questions and every one was moved past (Next, Skip or Finish), the
 * same "Checked in for today" state the Daily check-in shows.
 */
export function checkedIn(day: CheckinDayLike): boolean {
  return day.prompts.length > 0 && day.prompts.every((p) => day.answers.get(p)?.done === true);
}

/** The days she checked in. */
export function checkinDoneDays(days: readonly CheckinDayLike[]): Set<ISODate> {
  return new Set(days.filter(checkedIn).map((d) => d.date));
}

/** The days a card was marked done, or a tracker day filled in (on any device). */
export function exerciseDoneDays(marks: readonly ExerciseMark[]): Set<ISODate> {
  return new Set(marks.filter((m) => m.done || m.logged).map((m) => m.date));
}
