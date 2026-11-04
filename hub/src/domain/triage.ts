import type { Goal, ISODate, Item } from "./types";
import { daysBetween, weekdayOf } from "./dates";
import { doneToday, isHabit } from "./habits";
import { doneTodayIndex, isProject, plannedToday } from "./projects";

/**
 * Ticked off today: a habit with today in its done log, a to-do completed today, or a
 * project with a session ticked today (it stays crossed out for the rest of the day).
 */
export function tickedOffToday(it: Item, today: ISODate): boolean {
  // Not while another session is still planned for today: the main box then logs that one (M-2).
  if (isProject(it) && it.status === "open") return doneTodayIndex(it, today) >= 0 && !plannedToday(it, today);
  return isHabit(it) && it.status === "open" ? doneToday(it, today) : it.status === "done" && it.completedAt === today;
}

/**
 * Today keeps what was ticked off today. Habits done today stay in the rhythm list (also
 * one ticked on a day it is not planned for), and a project with a session ticked today
 * (not finished) stays in the Today list; both cross off in place, at the bottom of their
 * list. A plain to-do (or finished project) completed today leaves the list at once and
 * is returned in `doneToday`, for the "Done today" dropdown.
 */
export function withTickedOff(
  pick: { rhythm: Item[]; picks: Item[]; alsoDue: Item[] },
  items: Item[],
  today: ISODate,
): { rhythm: Item[]; picks: Item[]; alsoDue: Item[]; doneToday: Item[] } {
  const sorted = (i: Item) => i.kind === "task" && (i.areaId !== "inbox" || datedInbox(i));
  const inRhythm = new Set(pick.rhythm.map((i) => i.id));
  const extraHabits = items.filter(
    (i) => sorted(i) && isHabit(i) && i.status === "open" && doneToday(i, today) && !inRhythm.has(i.id),
  );
  const inPicks = new Set(pick.picks.map((i) => i.id));
  const startedProjects = items.filter(
    (i) => sorted(i) && !inPicks.has(i.id) && isProject(i) && i.status === "open" && doneTodayIndex(i, today) >= 0,
  );
  const finishedToday = items.filter((i) => sorted(i) && !isHabit(i) && i.status === "done" && i.completedAt === today);
  const lastIfTicked = (list: Item[]) => [
    ...list.filter((i) => !tickedOffToday(i, today)),
    ...list.filter((i) => tickedOffToday(i, today)),
  ];
  return {
    rhythm: lastIfTicked([...pick.rhythm, ...extraHabits]),
    picks: lastIfTicked([...pick.picks, ...startedProjects]),
    alsoDue: pick.alsoDue,
    doneToday: finishedToday,
  };
}

/**
 * An Inbox item is unsorted, so Today never picks it by priority or repeat; but a day or a
 * deadline she gave it from the Inbox ("Do it on", "Deadline") counts like any to-do's.
 */
export function datedInbox(i: Item): boolean {
  return i.areaId === "inbox" && (i.pinnedDate !== undefined || i.due !== undefined);
}

export const CAPACITY = 4;
export const DUE_HORIZON = 3;

const SUNDAY_DUE_LIMIT = 2;

/** True when the item's goal has a monthly target and completions lag the elapsed-month pace. */
function behindPace(
  it: Item,
  goals: Map<string, Goal>,
  today: ISODate,
  done: Record<string, number>,
): boolean {
  const g = it.goalId ? goals.get(it.goalId) : undefined;
  if (!g || !g.monthlyTarget) return false;
  const first = `${today.slice(0, 7)}-01`;
  const [y, m] = today.split("-").map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const nextFirst = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
  const monthLen = daysBetween(first, nextFirst);
  const elapsed = daysBetween(first, today) + 1;
  return (done[g.id] ?? 0) < (g.monthlyTarget * elapsed) / monthLen;
}

export function pickToday(
  items: Item[],
  goals: Goal[],
  today: ISODate,
  thisMonthDone: Record<string, number>,
): { rhythm: Item[]; picks: Item[]; alsoDue: Item[] } {
  const goalMap = new Map(goals.map((g) => [g.id, g]));
  const wd = weekdayOf(today);
  const behind = (it: Item) => (behindPace(it, goalMap, today, thisMonthDone) ? 0 : 1);

  const live = items.filter(
    (i) =>
      i.kind === "task" && i.status === "open" && (i.areaId !== "inbox" || datedInbox(i)) && i.hiddenOn !== today,
  );
  const inbox = (i: Item) => i.areaId === "inbox";

  const rhythm = live.filter((i) => !inbox(i) && i.recur?.includes(wd));
  const isRecurring = (i: Item) => (i.recur?.length ?? 0) > 0;
  const pool = live.filter((i) => !isRecurring(i));

  // A project shows when a session is planned for today (like a pin), or by its deadline;
  // it never fills Today by priority alone (projects round).
  const pinned = pool.filter((i) => i.pinnedDate === today || (isProject(i) && plannedToday(i, today)));
  // Items pinned to a later day were moved off today on purpose: never re-pick them early.
  const rest = pool.filter(
    (i) => (i.pinnedDate === undefined || i.pinnedDate < today) && !(isProject(i) && plannedToday(i, today)),
  );

  const due = rest
    .filter((i) => i.due !== undefined && daysBetween(today, i.due) <= DUE_HORIZON)
    .sort(
      (a, b) =>
        (a.due! < b.due! ? -1 : a.due! > b.due! ? 1 : 0) ||
        a.priority - b.priority ||
        behind(a) - behind(b),
    );

  const picks = [...pinned];

  if (wd === "sun") {
    picks.push(...due.slice(0, SUNDAY_DUE_LIMIT));
    return { rhythm, picks, alsoDue: due.slice(SUNDAY_DUE_LIMIT) };
  }

  const dueRoom = Math.max(0, CAPACITY - picks.length);
  picks.push(...due.slice(0, dueRoom));
  const alsoDue = due.slice(dueRoom);

  const dueIds = new Set(due.map((i) => i.id));
  const p1 = rest
    .filter((i) => i.priority === 1 && !dueIds.has(i.id) && !isProject(i) && !inbox(i))
    .sort((a, b) => behind(a) - behind(b));
  picks.push(...p1.slice(0, Math.max(0, CAPACITY - picks.length)));

  if (picks.length < CAPACITY) {
    const p2 = rest.filter((i) => i.priority === 2 && !dueIds.has(i.id) && !isProject(i) && !inbox(i));
    if (p2.length > 0) {
      const start = daysBetween("1970-01-01", today) % p2.length;
      const count = Math.min(CAPACITY - picks.length, p2.length);
      for (let k = 0; k < count; k++) picks.push(p2[(start + k) % p2.length]);
    }
  }

  return { rhythm, picks, alsoDue };
}
