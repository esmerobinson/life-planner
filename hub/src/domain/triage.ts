import type { Goal, ISODate, Item } from "./types";
import { daysBetween, weekdayOf } from "./dates";

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
      i.kind === "task" && i.status === "open" && i.areaId !== "inbox" && i.hiddenOn !== today,
  );

  const rhythm = live.filter((i) => i.recur?.includes(wd));
  const isRecurring = (i: Item) => (i.recur?.length ?? 0) > 0;
  const pool = live.filter((i) => !isRecurring(i));

  const pinned = pool.filter((i) => i.pinnedDate === today);
  const rest = pool.filter((i) => i.pinnedDate !== today);

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
    .filter((i) => i.priority === 1 && !dueIds.has(i.id))
    .sort((a, b) => behind(a) - behind(b));
  picks.push(...p1.slice(0, Math.max(0, CAPACITY - picks.length)));

  if (picks.length < CAPACITY) {
    const p2 = rest.filter((i) => i.priority === 2 && !dueIds.has(i.id));
    if (p2.length > 0) {
      const start = daysBetween("1970-01-01", today) % p2.length;
      const count = Math.min(CAPACITY - picks.length, p2.length);
      for (let k = 0; k < count; k++) picks.push(p2[(start + k) % p2.length]);
    }
  }

  return { rhythm, picks, alsoDue };
}
