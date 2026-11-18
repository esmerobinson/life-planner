import type { Goal, ISODate, Item } from "./types";
import { daysBetween, weekdayOf } from "./dates";
import { monthlyProgress } from "./progress";
import { doneToday, isHabit } from "./habits";
import { doneTodayIndex, isProject, plannedToday } from "./projects";
import type { TodayFill } from "./todayFill";

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

/**
 * The parts of Today's list: the rhythm (habits due today); what always shows (pinned to today,
 * a project session planned today, due today or overdue); the places left to fill (`room`) and
 * the fill candidates in the order they would fill them (due in the next few days, then priority
 * 1, then the priority 2 rotation; on Sunday only the first two due soon).
 */
function todayParts(items: Item[], goals: Goal[], today: ISODate, thisMonthDone: Record<string, number>) {
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

  // Anything due today or overdue is always on the list, however full it is: only things due
  // in the next few days wait in the dropdown (Esme, 2026-11-06: today's tasks were "sort of
  // hidden in a dropdown menu that says also due").
  const dueNow = due.filter((i) => i.due! <= today);
  const dueSoon = due.filter((i) => i.due! > today);
  const always = [...pinned, ...dueNow];

  if (wd === "sun") {
    const room = Math.max(0, SUNDAY_DUE_LIMIT - dueNow.length);
    return { rhythm, always, rest, dueSoon, room, candidates: dueSoon.slice(0, SUNDAY_DUE_LIMIT) };
  }

  const dueIds = new Set(due.map((i) => i.id));
  const p1 = rest
    .filter((i) => i.priority === 1 && !dueIds.has(i.id) && !isProject(i) && !inbox(i))
    .sort((a, b) => behind(a) - behind(b));
  const p2 = rest.filter((i) => i.priority === 2 && !dueIds.has(i.id) && !isProject(i) && !inbox(i));
  const start = p2.length > 0 ? daysBetween("1970-01-01", today) % p2.length : 0;
  const rotated = [...p2.slice(start), ...p2.slice(0, start)];
  const room = Math.max(0, CAPACITY - always.length);
  return { rhythm, always, rest, dueSoon, room, candidates: [...dueSoon, ...p1, ...rotated] };
}

/**
 * Today's list. `frozen`: the day's picks as first shown (domain/todayFill.ts). With them, the
 * list keeps those picks while they are still open and on for today, and only a place that was
 * never filled takes a new one: a pick removed, moved or ticked off is never replaced
 * (Esme, 2026-11-06). Pins and what is due today or overdue always show either way.
 */
export function pickToday(
  items: Item[],
  goals: Goal[],
  today: ISODate,
  thisMonthDone: Record<string, number>,
  frozen?: TodayFill,
): { rhythm: Item[]; picks: Item[]; alsoDue: Item[] } {
  const parts = todayParts(items, goals, today, thisMonthDone);
  const { rhythm, always, dueSoon } = parts;
  const fill = fillFrom(parts, frozen);
  const picks = [...always, ...fill];
  const shown = new Set(picks.map((i) => i.id));
  return { rhythm, picks, alsoDue: dueSoon.filter((i) => !shown.has(i.id)) };
}

/** The picks that fill the list: as the day first had them (still on), then any place never filled. */
function fillFrom(
  { always, rest, room, candidates }: { always: Item[]; rest: Item[]; room: number; candidates: Item[] },
  frozen: TodayFill | undefined,
): Item[] {
  if (!frozen) return candidates.slice(0, room);
  const alwaysIds = new Set(always.map((i) => i.id));
  const kept = new Set(frozen.ids);
  // A kept pick shows while it is still one Today could pick: open, not removed or moved off
  // today, and its deadline not pushed out (or taken off) since it was picked (M1).
  const pickable = new Map(rest.map((i) => [i.id, i]));
  const pushedOut = (i: Item) => {
    const was = frozen.dues?.[i.id];
    return was !== undefined && (i.due === undefined || i.due > was);
  };
  const still = frozen.ids
    .map((id) => pickable.get(id))
    .filter((i): i is Item => i !== undefined && !alwaysIds.has(i.id) && !pushedOut(i));
  const fresh = candidates.filter((i) => !kept.has(i.id) && !alwaysIds.has(i.id));
  return [...still, ...fresh.slice(0, Math.max(0, frozen.room - frozen.ids.length))];
}

/** Each active goal's ticks this month (inactive goals don't count: goals redesign). */
function pace(items: Item[], goals: Goal[], today: ISODate) {
  const active = goals.filter((g) => g.active !== false);
  const done = Object.fromEntries(active.map((g) => [g.id, monthlyProgress(g, items, today)?.done ?? 0]));
  return { active, done };
}

/**
 * Today's list exactly as Home shows it (TodayPanel; the farm reads it too): the picks from
 * the active goals' pace (kept for the day as `frozen` says), with what was ticked off today
 * kept as withTickedOff says.
 */
export function todayList(
  items: Item[],
  goals: Goal[],
  today: ISODate,
  frozen?: TodayFill,
): { rhythm: Item[]; picks: Item[]; alsoDue: Item[]; doneToday: Item[] } {
  const { active, done } = pace(items, goals, today);
  return withTickedOff(pickToday(items, active, today, done, frozen), items, today);
}

/**
 * What Home records for the day (domain/todayFill.ts): the picks filling the list (`frozen`'s
 * ids first, then any that took a place never filled) and how many places there were. With no
 * `frozen`, the day's first: the picks as worked out now.
 */
export function todayFill(items: Item[], goals: Goal[], today: ISODate, frozen?: TodayFill): TodayFill {
  const { active, done } = pace(items, goals, today);
  const parts = todayParts(items, active, today, done);
  const shown = fillFrom(parts, frozen);
  const dues = Object.fromEntries(shown.filter((i) => i.due !== undefined).map((i) => [i.id, i.due!]));
  const withDues = (f: TodayFill): TodayFill => (Object.keys(f.dues ?? {}).length > 0 ? f : { ids: f.ids, room: f.room });
  if (!frozen) return withDues({ ids: shown.map((i) => i.id), room: parts.room, dues });
  const kept = new Set(frozen.ids);
  const added = shown.filter((i) => !kept.has(i.id));
  return withDues({
    ids: [...frozen.ids, ...added.map((i) => i.id)],
    room: frozen.room,
    dues: { ...frozen.dues, ...Object.fromEntries(added.filter((i) => i.due !== undefined).map((i) => [i.id, i.due!])) },
  });
}
