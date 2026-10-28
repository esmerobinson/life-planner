import { addDays, monthOf } from "./dates";
import type { Goal, ISODate, Item } from "./types";

export type MonthlyProgress = { done: number; target: number; ratio: number };
export type OverallProgress =
  | { kind: "milestones"; done: number; total: number; ratio: number }
  | { kind: "evidence"; thisYear: number; monthsInARow: number; streakDays: number };

/** Completion dates of done tasks attached to this goal. */
function completions(goal: Goal, items: Item[]): ISODate[] {
  const out: ISODate[] = [];
  for (const it of items) {
    if (it.goalId === goal.id && it.kind === "task" && it.status === "done" && it.completedAt) {
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
