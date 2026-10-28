// Habits (round 3, option B): a recurring to-do. Ticking one logs today in `doneDates`;
// it never changes `status` and never goes into the Done fold-out. "Done for today" is
// derived from the date, so tomorrow it is unticked again without a write.

import { monthName } from "./display";
import { addDays, endOfMonth, monthOf, weekdayOf } from "./dates";
import type { ISODate, Item, Weekday } from "./types";

/** How many done days a habit keeps (the most recent). */
export const MAX_DONE_DATES = 400;

/** A recurring to-do (sorted out of the Inbox). */
export function isHabit(it: Item): boolean {
  return it.kind === "task" && (it.recur?.length ?? 0) > 0;
}

/** Ticked for today: today is in its done log. */
export function doneToday(it: Item, today: ISODate): boolean {
  return it.doneDates?.includes(today) ?? false;
}

/** The done log with `day` added (sorted, no repeats, the most recent MAX_DONE_DATES kept). */
export function withDoneDate(dates: ISODate[] | undefined, day: ISODate): ISODate[] {
  const all = [...new Set([...(dates ?? []), day])].sort();
  return all.slice(-MAX_DONE_DATES);
}

/** The done log without `day`; undefined when nothing is left. */
export function withoutDoneDate(dates: ISODate[] | undefined, day: ISODate): ISODate[] | undefined {
  const rest = (dates ?? []).filter((d) => d !== day);
  return rest.length ? rest : undefined;
}

/**
 * This month's sessions: planned = days in this month whose weekday is in `recur`;
 * done = days ticked this month (today included when ticked).
 */
export function sessions(it: Item, today: ISODate): { done: number; planned: number } {
  const month = monthOf(today);
  const days = new Set(it.recur ?? []);
  const [y, m] = today.split("-").map(Number);
  const last = endOfMonth(y, m);
  let planned = 0;
  for (let d = `${month}-01`; d <= last; d = addDays(d, 1)) if (days.has(weekdayOf(d))) planned++;
  const done = new Set((it.doneDates ?? []).filter((d) => monthOf(d) === month)).size;
  return { done, planned };
}

/** Habit session dates in a given month ("YYYY-MM"). */
export function sessionsIn(it: Item, month: string): number {
  return new Set((it.doneDates ?? []).filter((d) => monthOf(d) === month)).size;
}

const ORDER: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_NAMES: Record<Weekday, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday",
};

/**
 * PROVISIONAL WORDING (Esme: "there's probably something better"). Every habit line is here,
 * in one place, so it can be reworded at once.
 */
export const HABIT_WORDS = {
  heading: "Habits",
  /** The small line once it is ticked today. */
  doneForToday: "Done for today",
  /** The right-hand count: "October · session 20 of 28". */
  session: (today: ISODate, done: number, planned: number) => `${monthName(today)} · session ${done} of ${planned}`,
  /** The schedule line: "every day", "every day but Sunday", "Mondays", "Mondays and Thursdays". */
  schedule(recur: Weekday[] | undefined): string {
    const days = ORDER.filter((d) => recur?.includes(d));
    if (days.length === 7) return "every day";
    if (days.length === 6) return `every day but ${DAY_NAMES[ORDER.find((d) => !days.includes(d))!]}`;
    const names = days.map((d) => `${DAY_NAMES[d]}s`);
    return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  },
};
