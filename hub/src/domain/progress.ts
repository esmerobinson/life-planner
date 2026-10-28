import { addDays, mondayOf, monthOf } from "./dates";
import { isHabit } from "./habits";
import type { Goal, ISODate, Item } from "./types";

export type MonthlyProgress = { done: number; target: number; ratio: number };
export type OverallProgress =
  | { kind: "milestones"; done: number; total: number; ratio: number }
  | { kind: "evidence"; thisYear: number; monthsInARow: number; streakDays: number };

/** A to-do that has been sorted: Inbox items have no type until they are filed. */
const isSortedTask = (it: Item) => it.kind === "task" && it.areaId !== "inbox";

/** Every tick-off of one task: its completion, or each session of a habit (round 3). */
function tickOffDates(it: Item): ISODate[] {
  if (isHabit(it) && it.status === "open") return [...new Set(it.doneDates ?? [])];
  return it.status === "done" && it.completedAt ? [it.completedAt] : [];
}

/** Completion dates of tasks attached to this goal (habit sessions count one each). */
function completions(goal: Goal, items: Item[]): ISODate[] {
  const out: ISODate[] = [];
  for (const it of items) {
    if (it.goalId === goal.id && isSortedTask(it)) out.push(...tickOffDates(it));
  }
  return out;
}

/** A goal's linked to-dos (open or done; never archived or binned). */
export function goalTasks(goal: Goal, items: Item[]): Item[] {
  return items.filter(
    (it) => it.goalId === goal.id && isSortedTask(it) && (it.status === "open" || it.status === "done"),
  );
}

/**
 * The goal's overall progress (round 3: milestones are flagged tasks): done milestone-
 * flagged linked tasks out of all of them; with none flagged, all linked tasks; with no
 * linked tasks, null (no overall bar). `flagged` says which was counted.
 */
export function milestoneProgress(
  goal: Goal,
  items: Item[],
): { done: number; total: number; ratio: number; flagged: boolean } | null {
  // A habit never finishes, so it is not a step towards the goal's end.
  const linked = goalTasks(goal, items).filter((it) => !isHabit(it));
  const flagged = linked.filter((it) => it.milestone);
  const base = flagged.length > 0 ? flagged : linked;
  if (base.length === 0) return null;
  const done = base.filter((it) => it.status === "done").length;
  return { done, total: base.length, ratio: done / base.length, flagged: flagged.length > 0 };
}

export function monthlyProgress(goal: Goal, items: Item[], today: ISODate): MonthlyProgress | null {
  const target = goal.monthlyTarget;
  if (target === undefined || !(target > 0)) return null;
  const month = monthOf(today);
  const done = completions(goal, items).filter((d) => monthOf(d) === month).length;
  return { done, target, ratio: Math.min(1, done / target) };
}

function prevMonth(m: string): string {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return mo === 1 ? `${String(y - 1).padStart(4, "0")}-12` : `${m.slice(0, 5)}${String(mo - 1).padStart(2, "0")}`;
}

/** Months in a row (ending this month) with at least one tick-off for the goal. */
export function monthsInARow(goal: Goal, items: Item[], today: ISODate): number {
  const months = new Set(completions(goal, items).map(monthOf));
  let n = 0;
  for (let m = monthOf(today); months.has(m); m = prevMonth(m)) n++;
  return n;
}

export function overallProgress(goal: Goal, items: Item[], today: ISODate): OverallProgress {
  if (goal.kind === "finite") {
    const m = milestoneProgress(goal, items);
    return { kind: "milestones", done: m?.done ?? 0, total: m?.total ?? 0, ratio: m?.ratio ?? 0 };
  }
  const dates = completions(goal, items);
  const year = today.slice(0, 4);
  const thisYear = dates.filter((d) => d.slice(0, 4) === year).length;

  const days = new Set(dates);
  let cursor = days.has(today) ? today : addDays(today, -1);
  let streakDays = 0;
  while (days.has(cursor)) {
    streakDays++;
    cursor = addDays(cursor, -1);
  }
  return { kind: "evidence", thisYear, monthsInARow: monthsInARow(goal, items, today), streakDays };
}

export type TickedOff = { thisMonth: number; lastMonth: number; ratio: number };

/**
 * Done tasks in one area completed this calendar month and last; each habit session counts
 * as one tick-off (round 3). The ratio compares this month with last month's total:
 * min(1, thisMonth / max(lastMonth, 1)).
 */
export function tickedOff(areaId: string, items: Item[], today: ISODate): TickedOff {
  const month = monthOf(today);
  const last = prevMonth(month);
  let thisMonth = 0;
  let lastMonth = 0;
  for (const it of items) {
    if (it.areaId !== areaId || !isSortedTask(it)) continue;
    for (const d of tickOffDates(it)) {
      const m = monthOf(d);
      if (m === month) thisMonth++;
      else if (m === last) lastMonth++;
    }
  }
  return { thisMonth, lastMonth, ratio: Math.min(1, thisMonth / Math.max(lastMonth, 1)) };
}

/** A goal's open tasks, grouped Today / This week / Later (each in listing order). */
export function groupGoalTasks(goal: Goal, items: Item[], today: ISODate): { name: string; items: Item[] }[] {
  const monday = mondayOf(today);
  const sunday = addDays(monday, 6);
  const out = { Today: [] as Item[], "This week": [] as Item[], Later: [] as Item[] };
  for (const it of items) {
    if (it.goalId !== goal.id || !isSortedTask(it) || it.status !== "open") continue;
    if (it.pinnedDate === today) out.Today.push(it);
    else if (it.weekOf === monday || (it.pinnedDate && it.pinnedDate >= monday && it.pinnedDate <= sunday)) {
      out["This week"].push(it);
    } else out.Later.push(it);
  }
  return Object.entries(out).map(([name, items]) => ({ name, items }));
}

/** The goal's next step: its first open task in the goal page's order (Today, This week, Later). */
export function nextStep(goal: Goal, items: Item[], today: ISODate): Item | undefined {
  return groupGoalTasks(goal, items, today).flatMap((g) => g.items)[0];
}

/**
 * The goal panel's "To come" (open linked tasks, soonest first by due or pinned date; those
 * with neither last, in listing order) and "Completed" (done, newest first).
 */
export function goalTaskSplit(goal: Goal, items: Item[]): { toCome: Item[]; completed: Item[] } {
  const linked = goalTasks(goal, items);
  const when = (it: Item) => [it.due, it.pinnedDate].filter((d): d is string => !!d).sort()[0];
  const toCome = linked
    .filter((it) => it.status === "open")
    .map((it, i) => ({ it, i, d: when(it) }))
    .sort((a, b) => (a.d && b.d ? a.d.localeCompare(b.d) : a.d ? -1 : b.d ? 1 : 0) || a.i - b.i)
    .map((x) => x.it);
  const completed = linked
    .filter((it) => it.status === "done")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  return { toCome, completed };
}
