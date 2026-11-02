// Goals redesign (goals-redesign-brief.md; VISUAL-LANGUAGE.md "Goals redesign", "Goals can
// count themselves"): the maths for monthly goals, automatic counts, month dots, months in a
// row and daily streaks. Pure: the journal days and exercise marks come from the journal
// repo's reads, the to-dos from listItems.

import { endOfMonth, monthOf } from "./dates";
import { isSortedTask, tickOffDates } from "./progress";
import type { CountSource, Goal, ISODate, Item, MonthGoal } from "./types";
import { shiftMonth } from "../journal/calendar";
import { rowStatus, type RowStatus } from "../journal/rows";

/** Everything a goal can count from. */
export interface GoalSources {
  /** Days with a morning page, a morning photo or a check-in answer (by the rows' clear dates). */
  journalDays: ReadonlySet<ISODate>;
  /**
   * Exercise cards marked done (or tracker days logged), one per card per day; null while the
   * journal is locked on this device (they can't be read here), so they count as none.
   */
  exercise: readonly { date: ISODate; card: string }[] | null;
  /** Live to-dos and habits (listItems). */
  items: readonly Item[];
}

export const NO_SOURCES: GoalSources = { journalDays: new Set(), exercise: [], items: [] };

/** One counted thing: a key (so the same thing never counts twice) and its day. */
export interface GoalEvent {
  key: string;
  date: ISODate;
}

/** Missing `active` means active. */
export const isActive = (g: Goal): boolean => g.active !== false;
export const isDaily = (g: Goal): boolean => g.rhythm === "daily";
export const countsItself = (g: Goal): boolean => (g.countsFrom?.length ?? 0) > 0;

/** A count is automatic when its goal counts itself (unless it was set to stay manual). */
export const isAutoCount = (g: Goal, m: MonthGoal): boolean => m.kind === "count" && m.auto !== false && countsItself(g);

/** The same source, compared by value. */
export const sourceKey = (s: CountSource): string => (typeof s === "string" ? s : `area:${s.area}`);

/** Days in "YYYY-MM". */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return Number(endOfMonth(y!, m!).slice(8));
}

/** Every event the goal's sources hold, each once (a linked to-do in the counted area too). */
export function goalEvents(goal: Goal, src: GoalSources): GoalEvent[] {
  const out = new Map<string, ISODate>();
  const addItem = (it: Item) => {
    for (const d of tickOffDates(it)) out.set(`item:${it.id}:${d}`, d);
  };
  for (const s of goal.countsFrom ?? []) {
    if (s === "journal") for (const d of src.journalDays) out.set(`journal:${d}`, d);
    else if (s === "exercise") for (const e of src.exercise ?? []) out.set(`exercise:${e.date}:${e.card}`, e.date);
    else if (s === "linked") {
      for (const it of src.items) if (it.goalId === goal.id && isSortedTask(it)) addItem(it);
    } else {
      for (const it of src.items) if (it.areaId === s.area && isSortedTask(it)) addItem(it);
    }
  }
  return [...out].map(([key, date]) => ({ key, date }));
}

/**
 * The days that count for a goal: with sources, the days with at least one event; without,
 * the days logged on its counts (+1 or the Home row's tick).
 */
export function countedDays(goal: Goal, src: GoalSources): Set<ISODate> {
  if (countsItself(goal)) return new Set(goalEvents(goal, src).map((e) => e.date));
  const days = new Set<ISODate>();
  for (const m of goal.monthGoals ?? []) if (m.kind === "count") for (const d of m.log ?? []) days.add(d);
  return days;
}

/**
 * A count's number. Automatic: the month's events (a daily goal: days with at least one).
 * Manual: its +1s (a daily goal: distinct days). Steps have none (0).
 */
export function monthCount(goal: Goal, m: MonthGoal, src: GoalSources): number {
  if (m.kind !== "count") return 0;
  if (isAutoCount(goal, m)) {
    const evs = goalEvents(goal, src).filter((e) => monthOf(e.date) === m.month);
    return isDaily(goal) ? new Set(evs.map((e) => e.date)).size : evs.length;
  }
  const log = m.log ?? [];
  return isDaily(goal) ? new Set(log).size : log.length;
}

/** A monthly goal reached: a count at its target, a step ticked. */
export function monthGoalDone(goal: Goal, m: MonthGoal, src: GoalSources): boolean {
  if (m.kind === "step") return m.done === true;
  return m.target !== undefined && monthCount(goal, m, src) >= m.target;
}

/** The goal's monthly goals for "YYYY-MM", in the order they were added. */
export const goalsIn = (goal: Goal, month: string): MonthGoal[] => (goal.monthGoals ?? []).filter((m) => m.month === month);

/**
 * Whether the month was hit: its first count reached its target; with only steps, every step
 * ticked. null when the goal had no monthly goals that month (an empty dot).
 */
export function monthHit(goal: Goal, month: string, src: GoalSources): boolean | null {
  const mine = goalsIn(goal, month);
  if (mine.length === 0) return null;
  const count = mine.find((m) => m.kind === "count");
  if (count) return monthGoalDone(goal, count, src);
  return mine.every((m) => m.done === true);
}

/** The month's headline number: its first count (n of target), else its steps (done of all). */
export function monthSummary(goal: Goal, month: string, src: GoalSources): { n: number; of: number } | null {
  const mine = goalsIn(goal, month);
  if (mine.length === 0) return null;
  const count = mine.find((m) => m.kind === "count");
  if (count) return { n: monthCount(goal, count, src), of: count.target ?? 0 };
  return { n: mine.filter((m) => m.done === true).length, of: mine.length };
}

export interface MonthDot {
  month: string;
  /** true hit, false missed, null no monthly goals that month. */
  hit: boolean | null;
  /** This month (outlined). */
  now: boolean;
}

/** The last six months' dots, oldest first, this month last. */
export function monthDots(goal: Goal, today: ISODate, src: GoalSources): MonthDot[] {
  const now = monthOf(today);
  return [5, 4, 3, 2, 1, 0].map((back) => {
    const month = shiftMonth(now, -back);
    return { month, hit: monthHit(goal, month, src), now: back === 0 };
  });
}

/** Hit months in a row, ending last month (plus this month once it is already hit). */
export function monthsInARowHit(goal: Goal, today: ISODate, src: GoalSources): number {
  const now = monthOf(today);
  let n = monthHit(goal, now, src) === true ? 1 : 0;
  for (let m = shiftMonth(now, -1); monthHit(goal, m, src) === true; m = shiftMonth(m, -1)) n++;
  return n;
}

/** A daily goal's tick (counted today), streak, last seven days and days this month. */
export function dailyStatus(goal: Goal, today: ISODate, src: GoalSources): RowStatus {
  return rowStatus(countedDays(goal, src), today);
}

/** Months before this one that had monthly goals, newest first, with how each went. */
export function pastMonths(
  goal: Goal,
  today: ISODate,
  src: GoalSources,
): { month: string; hit: boolean; summary: { n: number; of: number } }[] {
  const now = monthOf(today);
  const months = [...new Set((goal.monthGoals ?? []).map((m) => m.month))].filter((m) => m < now).sort().reverse();
  return months.map((month) => ({
    month,
    hit: monthHit(goal, month, src) === true,
    summary: monthSummary(goal, month, src)!,
  }));
}

/** "Plan <month>" is offered: last month had counts, this month has no monthly goals yet. */
export function canPlanMonth(goal: Goal, today: ISODate): boolean {
  const now = monthOf(today);
  return goalsIn(goal, now).length === 0 && goalsIn(goal, shiftMonth(now, -1)).some((m) => m.kind === "count");
}

/**
 * This month's counts copied from last month's (same titles and targets; steps aren't
 * copied). A daily goal whose target was every day of last month gets every day of this one.
 */
export function plannedFromLastMonth(goal: Goal, today: ISODate, newId: () => string): MonthGoal[] {
  if (!canPlanMonth(goal, today)) return [];
  const now = monthOf(today);
  const last = shiftMonth(now, -1);
  return goalsIn(goal, last)
    .filter((m) => m.kind === "count")
    .map((m) => {
      const everyDay = isDaily(goal) && m.target === daysInMonth(last);
      const next: MonthGoal = { id: newId(), month: now, kind: "count", title: m.title };
      const target = everyDay ? daysInMonth(now) : m.target;
      if (target !== undefined) next.target = target;
      if (m.auto === false) next.auto = false;
      return next;
    });
}
