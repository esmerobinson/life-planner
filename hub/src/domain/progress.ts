import { addDays, mondayOf, monthOf } from "./dates";
import type { Goal, ISODate, Item } from "./types";

export type MonthlyProgress = { done: number; target: number; ratio: number };
export type OverallProgress =
  | { kind: "milestones"; done: number; total: number; ratio: number }
  | { kind: "evidence"; thisYear: number; monthsInARow: number; streakDays: number };

/** A to-do that has been sorted: Inbox items have no type until they are filed. */
const isSortedTask = (it: Item) => it.kind === "task" && it.areaId !== "inbox";

/** Completion dates of done tasks attached to this goal. */
function completions(goal: Goal, items: Item[]): ISODate[] {
  const out: ISODate[] = [];
  for (const it of items) {
    if (it.goalId === goal.id && isSortedTask(it) && it.status === "done" && it.completedAt) {
      out.push(it.completedAt);
    }
  }
  return out;
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

export function overallProgress(goal: Goal, items: Item[], today: ISODate): OverallProgress {
  if (goal.kind === "finite") {
    const total = goal.milestones.length;
    const done = goal.milestones.filter((m) => m.done).length;
    return { kind: "milestones", done, total, ratio: total === 0 ? 0 : done / total };
  }
  const dates = completions(goal, items);
  const year = today.slice(0, 4);
  const thisYear = dates.filter((d) => d.slice(0, 4) === year).length;

  const months = new Set(dates.map(monthOf));
  let monthsInARow = 0;
  for (let m = monthOf(today); months.has(m); m = prevMonth(m)) monthsInARow++;

  const days = new Set(dates);
  let cursor = days.has(today) ? today : addDays(today, -1);
  let streakDays = 0;
  while (days.has(cursor)) {
    streakDays++;
    cursor = addDays(cursor, -1);
  }
  return { kind: "evidence", thisYear, monthsInARow, streakDays };
}

export type TickedOff = { thisMonth: number; lastMonth: number; ratio: number };

/**
 * Done tasks in one area completed this calendar month and last. The ratio compares this
 * month with last month's total: min(1, thisMonth / max(lastMonth, 1)).
 */
export function tickedOff(areaId: string, items: Item[], today: ISODate): TickedOff {
  const month = monthOf(today);
  const last = prevMonth(month);
  let thisMonth = 0;
  let lastMonth = 0;
  for (const it of items) {
    if (it.areaId !== areaId || !isSortedTask(it) || it.status !== "done" || !it.completedAt) continue;
    const m = monthOf(it.completedAt);
    if (m === month) thisMonth++;
    else if (m === last) lastMonth++;
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
