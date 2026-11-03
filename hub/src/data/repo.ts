import { db } from "./db";
import { MAX_GOAL_NOTES, MAX_GOAL_TEXT, MAX_MONTH_GOALS, MAX_MONTH_LOG, MAX_MONTH_TARGET, MAX_MONTH_TITLE } from "./validate";
import { pictureIds } from "../domain/page";
import { addDays, isValidISODate, mondayOf, monthOf } from "../domain/dates";
import { daysInMonth, plannedFromLastMonth } from "../domain/goalCounts";
import { isHabit, withDoneDate, withoutDoneDate } from "../domain/habits";
import { milestoneTask } from "../domain/milestones";
import {
  DEFAULT_SESSIONS, MAX_SESSION_DETAILS, MAX_SESSION_TITLE, MAX_SESSIONS, MIN_SESSIONS, doneTodayIndex, isProject, newSessions,
  nextSessionIndex, withSessions,
} from "../domain/projects";
import { SUGGESTED_GOALS, suggestedGoalRow } from "../domain/suggestedGoals";
export * from "./journalRepo";
import {
  AREA_IDS, type AreaId, type CountSource, type FileRow, type Goal, type ISODate, type Item, type Milestone, type MonthGoal,
  type Session,
} from "../domain/types";

export async function createItem(
  input: Omit<Item, "id" | "status" | "links" | "createdAt" | "touchedAt"> & { links?: string[] },
  today: ISODate,
): Promise<Item> {
  const item: Item = {
    ...input,
    id: crypto.randomUUID(),
    status: "open",
    links: input.links ?? [],
    createdAt: today,
    touchedAt: today,
  };
  await db.items.add(item);
  return (await db.items.get(item.id)) ?? item; // as stored, with its updatedAt
}

/**
 * Creates a goal. Milestones given here become milestone-flagged linked tasks in the
 * goal's area (round 3: there is no separate milestones list), in the same transaction;
 * the goal's own list stays empty.
 */
export async function createGoal(
  input: Omit<Goal, "id" | "createdAt" | "milestones"> & { milestones?: Milestone[] },
  today: ISODate,
): Promise<Goal> {
  if (input.kind === "finite" && !input.deadline) {
    throw new Error("finite goals need a deadline");
  }
  const { milestones = [], ...rest } = input;
  const goal: Goal = {
    ...rest,
    id: crypto.randomUUID(),
    milestones: [],
    createdAt: today,
  };
  return db.transaction("rw", db.goals, db.items, async () => {
    await db.goals.add(goal);
    if (milestones.length) await db.items.bulkAdd(milestones.map((m, i) => milestoneTask(goal, m, today, i)));
    return (await db.goals.get(goal.id)) ?? goal; // as stored, with its updatedAt
  });
}

/** The goal fields the panel's Edit mode may change. */
export interface GoalPatch {
  title?: string;
  areaId?: AreaId;
  /** "finite" (finish by a date) or "practice". Practice drops the deadline. */
  kind?: Goal["kind"];
  deadline?: ISODate | undefined;
  monthlyTarget?: number | undefined;
  /** Blank text removes them. At most MAX_GOAL_TEXT characters each (notes: MAX_GOAL_NOTES). */
  why?: string | undefined;
  cadence?: string | undefined;
  notes?: string | undefined;
  /** "daily" makes it a daily goal (and a practice); undefined takes that off. */
  rhythm?: "daily" | undefined;
  /** What counts for it by itself; an empty list or undefined removes the field. */
  countsFrom?: CountSource[] | undefined;
}

/**
 * Edits a goal in one transaction, with the same rules as createGoal (a finite goal keeps
 * a real deadline; goals are never in the inbox). A key that is present with the value
 * undefined clears that field. Milestones and source are never touched.
 */
export async function updateGoal(id: string, patch: GoalPatch, _today: ISODate): Promise<void> {
  await db.transaction("rw", db.goals, async () => {
    const goal = await db.goals.get(id);
    if (!goal) throw new Error("that goal does not exist");
    const next: Goal = { ...goal };
    if ("title" in patch) {
      const title = (patch.title ?? "").trim();
      if (!title) throw new Error("a goal needs a title");
      next.title = title;
    }
    if ("areaId" in patch) {
      if (!patch.areaId || patch.areaId === "inbox" || !(AREA_IDS as readonly string[]).includes(patch.areaId)) {
        throw new Error("a goal needs an area other than the inbox");
      }
      next.areaId = patch.areaId;
    }
    if ("kind" in patch) {
      if (patch.kind !== "finite" && patch.kind !== "practice") throw new Error("a goal is finite or practice");
      next.kind = patch.kind;
      if (patch.kind === "practice") delete next.deadline;
      if (patch.kind === "finite" && patch.rhythm !== "daily") delete next.rhythm; // a daily goal is a practice
    }
    for (const key of ["why", "cadence", "notes"] as const) {
      if (!(key in patch)) continue;
      const text = patch[key];
      if (text === undefined || !text.trim()) delete next[key];
      else if (text.length > (key === "notes" ? MAX_GOAL_NOTES : MAX_GOAL_TEXT)) {
        throw new Error(`at most ${key === "notes" ? MAX_GOAL_NOTES : MAX_GOAL_TEXT} characters`);
      }
      else next[key] = text;
    }
    if ("deadline" in patch) {
      if (patch.deadline === undefined) delete next.deadline;
      else next.deadline = patch.deadline;
    }
    if (next.deadline !== undefined && !isValidISODate(next.deadline)) throw new Error("that deadline is not a real date");
    if (next.kind === "finite" && !next.deadline) throw new Error("finite goals need a deadline");
    if ("monthlyTarget" in patch) {
      const t = patch.monthlyTarget;
      if (t === undefined) delete next.monthlyTarget;
      else if (!Number.isInteger(t) || t < 1) throw new Error("a monthly target is a whole number, 1 or more");
      else next.monthlyTarget = t;
    }
    if ("rhythm" in patch) {
      if (patch.rhythm === "daily") {
        next.rhythm = "daily";
        next.kind = "practice";
        delete next.deadline;
      } else delete next.rhythm;
    }
    if ("countsFrom" in patch) {
      const seen = new Set<string>();
      const list = (patch.countsFrom ?? []).filter((s) => {
        const k = typeof s === "string" ? s : `area:${s.area}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (list.length) next.countsFrom = list;
      else delete next.countsFrom;
    }
    await db.goals.put(next);
  });
}

/**
 * Updates an item. A key that is present with the value undefined is REMOVED from the
 * row (e.g. `{ kind: "idea", due: undefined, recur: undefined }`); keys left out of the
 * patch are untouched.
 */
export async function updateItem(id: string, patch: Partial<Item>, today: ISODate): Promise<void> {
  await db.items.update(id, { ...patch, touchedAt: today });
}

/**
 * Turns an item into a practice goal in ONE transaction: the goal is created (title and
 * notes from the item) and the item is archived, never deleted, with "Became a goal:
 * <title>" appended to its notes. Goals cannot live in the inbox, so an inbox area
 * becomes admin. Returns the new goal.
 */
export async function itemToGoal(itemId: string, areaId: AreaId, today: ISODate): Promise<Goal> {
  const area: AreaId = areaId === "inbox" ? "admin" : areaId;
  if (!(AREA_IDS as readonly string[]).includes(area)) throw new Error("that area does not exist");
  return db.transaction("rw", db.items, db.goals, async () => {
    const item = await db.items.get(itemId);
    if (!item) throw new Error("that item does not exist");
    if (item.status !== "open") throw new Error("only an open item can become a goal");
    const goal: Goal = {
      id: crypto.randomUUID(),
      title: item.title,
      areaId: area,
      kind: "practice",
      milestones: [],
      createdAt: today,
    };
    // A goal's notes are limited to 4000 characters (the backup validator's rule); the full text stays on the item.
    if (item.notes) goal.notes = item.notes.slice(0, 4000);
    await db.goals.add(goal);
    const line = `Became a goal: ${goal.title}`;
    await db.items.update(itemId, {
      status: "archived",
      touchedAt: today,
      notes: item.notes ? `${item.notes}\n${line}` : line,
    });
    return (await db.goals.get(goal.id)) ?? goal; // as stored, with its updatedAt
  });
}

/**
 * Ticks an item off. A to-do becomes done (completedAt today). A habit (an open recurring
 * to-do) instead logs today in its doneDates and stays open: it never goes to Done.
 */
export async function tickItem(id: string, today: ISODate): Promise<void> {
  await db.transaction("rw", db.items, async () => {
    const item = await db.items.get(id);
    if (!item || item.status === "done") return;
    if (isProject(item)) {
      // A project logs its next session today; with every session done already, it is just done.
      const i = nextSessionIndex(item, today);
      const sessions = item.sessions!.map((s, k) => (k === i ? { ...s, doneOn: today } : s));
      await db.items.put({ ...withSessions(item, sessions, today), touchedAt: today });
      return;
    }
    if (isHabit(item) && item.status === "open") {
      if (item.doneDates?.includes(today)) return;
      await db.items.update(id, { doneDates: withDoneDate(item.doneDates, today), touchedAt: today });
      return;
    }
    await db.items.update(id, { status: "done", completedAt: today, touchedAt: today });
  });
}

/** Unticks: a done item is open again; a habit loses today from its doneDates. */
export async function untickItem(id: string, today: ISODate): Promise<void> {
  await db.transaction("rw", db.items, async () => {
    const item = await db.items.get(id);
    if (!item) return;
    if (isProject(item)) {
      // Today's session comes off; a done project reopens with its last-ticked session unticked.
      let i = doneTodayIndex(item, today);
      if (i < 0 && item.status === "done") i = lastTicked(item.sessions!);
      if (i < 0) return;
      const sessions = item.sessions!.map((s, k) => (k === i ? withoutDone(s) : s));
      await db.items.put({ ...withSessions(item, sessions, today), touchedAt: today });
      return;
    }
    if (isHabit(item) && item.status === "open") {
      if (!item.doneDates?.includes(today)) return;
      const { doneDates, ...rest } = item;
      const left = withoutDoneDate(doneDates, today);
      await db.items.put({ ...rest, ...(left ? { doneDates: left } : {}), touchedAt: today });
      return;
    }
    const { completedAt: _drop, ...rest } = item;
    await db.items.put({ ...rest, status: "open", touchedAt: today });
  });
}

/** A session without its tick. */
function withoutDone(s: Session): Session {
  const { doneOn: _d, ...rest } = s;
  return rest;
}

/** The session ticked last (latest doneOn; on a tie the later one in the list), or -1. */
function lastTicked(list: Session[]): number {
  let best = -1;
  list.forEach((s, k) => {
    if (s.doneOn !== undefined && (best < 0 || s.doneOn >= list[best].doneOn!)) best = k;
  });
  return best;
}

/**
 * Changes a live project's sessions in one transaction: `fn` gets a copy and returns the new
 * list. The status follows (done when every session is). Throws for anything not a project.
 */
async function editSessions(itemId: string, today: ISODate, fn: (list: Session[]) => Session[]): Promise<void> {
  await db.transaction("rw", db.items, async () => {
    const item = await db.items.get(itemId);
    if (!item || !isProject(item) || (item.status !== "open" && item.status !== "done")) {
      throw new Error("that project does not exist");
    }
    const next = fn(item.sessions!.map((s) => ({ ...s })));
    if (next.length < MIN_SESSIONS || next.length > MAX_SESSIONS) throw new Error(`a project has ${MIN_SESSIONS} to ${MAX_SESSIONS} sessions`);
    await db.items.put({ ...withSessions(item, next, today), touchedAt: today });
  });
}

/** A session box: ticks that session (today's date) or unticks it. Ticking the last makes the project done. */
export async function setSessionDone(itemId: string, sessionId: string, done: boolean, today: ISODate): Promise<void> {
  await editSessions(itemId, today, (list) =>
    list.map((s) => (s.id !== sessionId ? s : done ? { ...s, doneOn: s.doneOn ?? today } : withoutDone(s))),
  );
}

/**
 * A session's title, details or planned day. A key present with blank text (or undefined)
 * removes that field. Title at most 120 characters, details 1000.
 */
export async function updateSession(
  itemId: string,
  sessionId: string,
  patch: { title?: string; details?: string; plannedFor?: ISODate | undefined },
  today: ISODate,
): Promise<void> {
  if (patch.title !== undefined && patch.title.trim().length > MAX_SESSION_TITLE) {
    throw new Error(`a session title is at most ${MAX_SESSION_TITLE} characters`);
  }
  if (patch.details !== undefined && patch.details.length > MAX_SESSION_DETAILS) {
    throw new Error(`session details are at most ${MAX_SESSION_DETAILS} characters`);
  }
  if (patch.plannedFor !== undefined && !isValidISODate(patch.plannedFor)) throw new Error("that is not a real date");
  await editSessions(itemId, today, (list) =>
    list.map((s) => {
      if (s.id !== sessionId) return s;
      const next: Session = { ...s };
      if ("title" in patch) {
        const t = patch.title?.trim() ?? "";
        if (t) next.title = t;
        else delete next.title;
      }
      if ("details" in patch) {
        if (patch.details?.trim()) next.details = patch.details;
        else delete next.details;
      }
      if ("plannedFor" in patch) {
        if (patch.plannedFor !== undefined) next.plannedFor = patch.plannedFor;
        else delete next.plannedFor;
      }
      return next;
    }),
  );
}

/** "+ Add a session": an unnamed one at the end (a done project is open again). Returns its id. */
export async function addSession(itemId: string, today: ISODate): Promise<string> {
  const [s] = newSessions(1);
  await editSessions(itemId, today, (list) => [...list, s]);
  return s.id;
}

/** Removes a session that is not done (a project keeps at least one). */
export async function removeSession(itemId: string, sessionId: string, today: ISODate): Promise<void> {
  await editSessions(itemId, today, (list) => {
    const s = list.find((x) => x.id === sessionId);
    if (!s) return list;
    if (s.doneOn !== undefined) throw new Error("a done session cannot be removed");
    if (list.length <= MIN_SESSIONS) throw new Error("a project keeps at least one session");
    return list.filter((x) => x.id !== sessionId);
  });
}

/**
 * "Change to → Project": an open to-do or idea becomes a project to-do, keeping its title,
 * area, notes and deadline, with DEFAULT_SESSIONS unnamed sessions (`count` to choose). A
 * project does not repeat, so a habit's repeat days are dropped.
 */
export async function changeToProject(itemId: string, today: ISODate, count = DEFAULT_SESSIONS): Promise<void> {
  if (!Number.isInteger(count) || count < MIN_SESSIONS || count > MAX_SESSIONS) throw new Error("that is not a session count");
  await db.transaction("rw", db.items, async () => {
    const item = await db.items.get(itemId);
    if (!item || item.status !== "open") throw new Error("only an open item can become a project");
    if (isProject(item)) return;
    const { recur: _r, ...rest } = item;
    await db.items.put({ ...rest, kind: "task", sessions: newSessions(count), touchedAt: today });
  });
}

export async function moveTo(
  id: string,
  list: "today" | "tomorrow" | "week",
  today: ISODate,
): Promise<void> {
  await db.transaction("rw", db.items, async () => {
    const item = await db.items.get(id);
    if (!item) return;
    const { hiddenOn: _h, pinnedDate: _p, ...rest } = item;
    const next: Item = { ...rest, touchedAt: today };
    if (list === "today") next.pinnedDate = today;
    else if (list === "tomorrow") next.pinnedDate = addDays(today, 1);
    else {
      next.weekOf = mondayOf(today);
      next.hiddenOn = today; // off Today for the rest of today, like Remove from today
    }
    await db.items.put(next);
  });
}

/**
 * Schedule for: pins the item to a day (it shows on Today that day) or, with undefined,
 * clears the pin. Pinning also clears a "Remove from today" hide so a pin for today shows
 * at once. The due date is never changed.
 */
export async function pinTo(id: string, date: ISODate | undefined, today: ISODate): Promise<void> {
  if (date !== undefined && !isValidISODate(date)) throw new Error("that is not a real date");
  await db.transaction("rw", db.items, async () => {
    const item = await db.items.get(id);
    if (!item) return;
    const { pinnedDate: _p, hiddenOn, ...rest } = item;
    const next: Item = { ...rest, touchedAt: today };
    if (date !== undefined) next.pinnedDate = date;
    else if (hiddenOn !== undefined) next.hiddenOn = hiddenOn;
    await db.items.put(next);
  });
}

export async function removeFromToday(id: string, today: ISODate): Promise<void> {
  await db.transaction("rw", db.items, async () => {
    const item = await db.items.get(id);
    if (!item) return;
    const { pinnedDate: _p, ...rest } = item;
    await db.items.put({ ...rest, hiddenOn: today, touchedAt: today });
  });
}

export async function archiveItem(id: string, today: ISODate): Promise<void> {
  await db.items.update(id, { status: "archived", touchedAt: today });
}

/**
 * Archives many items in ONE transaction (all or nothing). Never deletes; unknown ids are
 * skipped silently. Returns how many items were archived.
 */
export async function archiveItems(ids: string[], today: ISODate): Promise<number> {
  return db.transaction("rw", db.items, async () => {
    let n = 0;
    for (const id of ids) {
      if (!(await db.items.get(id))) continue;
      await db.items.update(id, { status: "archived", touchedAt: today });
      n++;
    }
    return n;
  });
}

export async function restoreItem(id: string, today: ISODate): Promise<void> {
  await db.transaction("rw", db.items, async () => {
    const item = await db.items.get(id);
    if (!item) return;
    await db.items.update(id, {
      status: item.completedAt ? "done" : "open",
      touchedAt: today,
    });
  });
}

/** Rows in the Bin, or emptied from it: never shown outside the Bin page (purged: nowhere). */
const BINNED: readonly Item["status"][] = ["deleted", "purged"];

/**
 * Items for every list and count in the app. Never returns Bin rows (deleted or purged);
 * without a status it returns open and done items.
 */
export async function listItems(
  filter: {
    areaId?: AreaId;
    goalId?: string;
    status?: "open" | "done" | "archived";
    kind?: Item["kind"];
  } = {},
): Promise<Item[]> {
  const all = await db.items.toArray();
  return all.filter(
    (i) =>
      !BINNED.includes(i.status) &&
      (filter.status ? i.status === filter.status : i.status !== "archived") &&
      (!filter.areaId || i.areaId === filter.areaId) &&
      (!filter.goalId || i.goalId === filter.goalId) &&
      (!filter.kind || i.kind === filter.kind),
  );
}

/** Live goals, for every list, picker and count. Bin goals (deleted or purged) never appear. */
export async function listGoals(): Promise<Goal[]> {
  return (await db.goals.toArray()).filter((g) => g.status === undefined);
}

/** Flags a task as one of its goal's milestones, or unflags it (the field is then removed). */
export async function setMilestone(id: string, milestone: boolean, today: ISODate): Promise<void> {
  await db.transaction("rw", db.items, async () => {
    const item = await db.items.get(id);
    if (!item) return;
    const { milestone: _m, ...rest } = item;
    await db.items.put(milestone ? { ...rest, milestone: true, touchedAt: today } : { ...rest, touchedAt: today });
  });
}

/** "Show on Home": picks a goal for the Home goals column, or takes it off (the field is then removed). */
export async function setGoalOnHome(id: string, onHome: boolean): Promise<void> {
  await db.transaction("rw", db.goals, async () => {
    const goal = await db.goals.get(id);
    if (!goal || goal.status !== undefined) return;
    const { onHome: _o, ...rest } = goal;
    await db.goals.put(onHome ? { ...rest, onHome: true } : rest);
  });
}

/** Active / Inactive (goals redesign). Active is the default, so the field is then removed. */
export async function setGoalActive(id: string, active: boolean): Promise<void> {
  await db.transaction("rw", db.goals, async () => {
    const goal = await db.goals.get(id);
    if (!goal || goal.status !== undefined) return;
    const { active: _a, ...rest } = goal;
    await db.goals.put(active ? rest : { ...rest, active: false });
  });
}

/**
 * Changes a live goal's monthly goals in one transaction. `fn` gets a copy of the list and
 * returns the new one (or null for no change). Concurrent edits on two devices: the goal row
 * is last-write-wins, so one of two +1s made at the same moment may be lost.
 */
async function editMonthGoals(goalId: string, fn: (list: MonthGoal[], goal: Goal) => MonthGoal[] | null): Promise<void> {
  await db.transaction("rw", db.goals, async () => {
    const goal = await db.goals.get(goalId);
    if (!goal || goal.status !== undefined) throw new Error("that goal does not exist");
    const next = fn((goal.monthGoals ?? []).map((m) => ({ ...m, ...(m.log ? { log: [...m.log] } : {}) })), goal);
    if (next === null) return;
    if (next.length > MAX_MONTH_GOALS) throw new Error("that goal has too many monthly goals");
    const { monthGoals: _m, ...rest } = goal;
    await db.goals.put(next.length ? { ...rest, monthGoals: next } : rest);
  });
}

function cleanTitle(title: string): string {
  const t = title.trim();
  if (!t) throw new Error("a monthly goal needs a title");
  if (t.length > MAX_MONTH_TITLE) throw new Error(`at most ${MAX_MONTH_TITLE} characters`);
  return t;
}

function cleanTarget(target: number | undefined): number {
  if (target === undefined || !Number.isInteger(target) || target < 1 || target > MAX_MONTH_TARGET) {
    throw new Error("a count's target is a whole number, 1 or more");
  }
  return target;
}

/** "+ Add a <Month> goal": a count (with a target) or a step, for this month. */
export async function addMonthGoal(
  goalId: string,
  input: { kind: MonthGoal["kind"]; title: string; target?: number },
  today: ISODate,
): Promise<string> {
  const id = crypto.randomUUID();
  const m: MonthGoal = { id, month: monthOf(today), kind: input.kind, title: cleanTitle(input.title) };
  if (input.kind === "count") m.target = cleanTarget(input.target);
  await editMonthGoals(goalId, (list) => [...list, m]);
  return id;
}

/** Edit mode: a monthly goal's title and (counts) target. */
export async function updateMonthGoal(goalId: string, id: string, patch: { title?: string; target?: number }): Promise<void> {
  await editMonthGoals(goalId, (list) =>
    list.map((m) => {
      if (m.id !== id) return m;
      const next = { ...m };
      if (patch.title !== undefined) next.title = cleanTitle(patch.title);
      if (patch.target !== undefined && m.kind === "count") next.target = cleanTarget(patch.target);
      return next;
    }),
  );
}

/** Edit mode: removes a monthly goal. */
export async function removeMonthGoal(goalId: string, id: string): Promise<void> {
  await editMonthGoals(goalId, (list) => (list.some((m) => m.id === id) ? list.filter((m) => m.id !== id) : null));
}

/** One change made to a monthly goal during an Edit session (what Cancel may undo). */
export type MonthEdit =
  | { kind: "retitle"; id: string; from: string; to: string }
  | { kind: "retarget"; id: string; from: number; to: number }
  | { kind: "remove"; entry: MonthGoal; index: number }
  | { kind: "add"; id: string };

/**
 * Edit mode's Cancel: undoes this session's own changes, newest first, and only where the
 * goal still holds what the session set. A title or target that has changed since (say by
 * sync) stays; a removed goal comes back only if its id is still missing; an added one is
 * taken out again. Ticks and logs are never touched. Writes nothing when nothing applies.
 */
export async function undoMonthEdits(goalId: string, edits: readonly MonthEdit[]): Promise<void> {
  if (edits.length === 0) return;
  await editMonthGoals(goalId, (list) => {
    let next = list;
    for (const e of [...edits].reverse()) {
      if (e.kind === "add") next = next.filter((m) => m.id !== e.id);
      else if (e.kind === "remove") {
        if (next.some((m) => m.id === e.entry.id)) continue;
        const back = { ...e.entry, ...(e.entry.log ? { log: [...e.entry.log] } : {}) };
        next = [...next.slice(0, e.index), back, ...next.slice(e.index)];
      } else if (e.kind === "retitle") {
        next = next.map((m) => (m.id === e.id && m.title === e.to ? { ...m, title: e.from } : m));
      } else {
        next = next.map((m) => (m.id === e.id && m.target === e.to ? { ...m, target: e.from } : m));
      }
    }
    return JSON.stringify(next) === JSON.stringify(list) ? null : next;
  });
}

/** Ticks a step goal, or unticks it. */
export async function setMonthStep(goalId: string, id: string, done: boolean): Promise<void> {
  await editMonthGoals(goalId, (list) =>
    list.map((m) => {
      if (m.id !== id || m.kind !== "step") return m;
      const { done: _d, ...rest } = m;
      return done ? { ...rest, done: true } : rest;
    }),
  );
}

/** +1 on a manual count: today goes on its log (a daily goal counts days, so once a day: review M4). */
export async function plusOne(goalId: string, id: string, today: ISODate): Promise<void> {
  await editMonthGoals(goalId, (list, goal) =>
    list.map((m) => {
      if (m.id !== id || m.kind !== "count") return m;
      if (goal.rhythm === "daily" && m.log?.includes(today)) return m;
      const log = [...(m.log ?? []), today];
      if (log.length > MAX_MONTH_LOG) throw new Error("that count is full");
      return { ...m, log };
    }),
  );
}

/** −1: undoes the last +1 on a manual count. */
export async function minusOne(goalId: string, id: string): Promise<void> {
  await editMonthGoals(goalId, (list) =>
    list.map((m) => {
      if (m.id !== id || !m.log?.length) return m;
      const { log, ...rest } = m;
      const left = log.slice(0, -1);
      return left.length ? { ...rest, log: left } : rest;
    }),
  );
}

/** "Plan <Month>": this month's counts copied from last month's (steps aren't copied). */
export async function planMonth(goalId: string, today: ISODate): Promise<void> {
  await editMonthGoals(goalId, (list, goal) => {
    const plan = plannedFromLastMonth({ ...goal, monthGoals: list }, today, () => crypto.randomUUID());
    return plan.length ? [...list, ...plan] : null;
  });
}

/** The title of the count a daily goal's Home tick makes when the month has none to log on. */
export const DAILY_COUNT_TITLE = "Days";

/**
 * A daily goal without automatic sources: its Home row's tick logs today on this month's
 * first count (unticking takes today off). With no count this month yet, last month's are
 * planned first; with none at all, a count of every day this month is made.
 */
export async function tickDailyGoal(goalId: string, today: ISODate, on: boolean): Promise<void> {
  await editMonthGoals(goalId, (list, goal) => {
    const month = monthOf(today);
    let next = list;
    if (on && !next.some((m) => m.month === month && m.kind === "count")) {
      const plan = plannedFromLastMonth({ ...goal, monthGoals: next }, today, () => crypto.randomUUID());
      next = plan.length
        ? [...next, ...plan]
        : [...next, { id: crypto.randomUUID(), month, kind: "count", title: DAILY_COUNT_TITLE, target: daysInMonth(month) }];
    }
    const first = next.find((m) => m.month === month && m.kind === "count");
    if (!first) return null;
    const has = first.log?.includes(today) ?? false;
    if (on === has) return next === list ? null : next;
    return next.map((m) => {
      if (m !== first) return m;
      if (on) return { ...m, log: [...(m.log ?? []), today] };
      const { log, ...rest } = m;
      const left = (log ?? []).filter((d) => d !== today);
      return left.length ? { ...rest, log: left } : rest;
    });
  });
}

/**
 * Adds one of the Suggested goals (only on her tap). Its id is fixed, so a second tap (or
 * another device's) changes nothing. One in the Bin is restored as it was (its monthly goals and
 * notes kept, review M2); only an emptied (purged) one is made fresh.
 */
export async function addSuggestedGoal(id: string, today: ISODate): Promise<void> {
  const s = SUGGESTED_GOALS.find((g) => g.id === id);
  if (!s) throw new Error("that is not a suggested goal");
  await db.transaction("rw", db.goals, async () => {
    const there = await db.goals.get(id);
    if (there && there.status === undefined) return;
    if (there?.status === "deleted") {
      const { status: _s, deletedAt: _d, ...rest } = there;
      await db.goals.put(rest);
      return;
    }
    await db.goals.put(suggestedGoalRow(s, today));
  });
}

/** Saves a goal's notes (the panel's page); blank text removes them. */
export async function saveGoalNotes(id: string, notes: string): Promise<void> {
  if (notes.length > MAX_GOAL_NOTES) throw new Error(`at most ${MAX_GOAL_NOTES} characters`);
  await db.transaction("rw", db.goals, async () => {
    const goal = await db.goals.get(id);
    if (!goal || goal.status !== undefined) return;
    const { notes: _n, ...rest } = goal;
    await db.goals.put(notes.trim() ? { ...rest, notes } : rest);
  });
}

/** Bulk filing: one transaction, unknown ids skipped, only the patched fields (plus touchedAt) change. */
export async function updateItems(
  ids: string[],
  patch: Pick<Partial<Item>, "areaId" | "goalId" | "priority" | "due">,
  today: ISODate,
): Promise<void> {
  await db.transaction("rw", db.items, async () => {
    for (const id of ids) {
      const item = await db.items.get(id);
      if (!item) continue;
      // Copy only the four fields meant to change, so a cast-in field cannot ride along.
      const changes: Pick<Partial<Item>, "areaId" | "goalId" | "priority" | "due"> = {};
      if (patch.areaId !== undefined) changes.areaId = patch.areaId;
      if (patch.goalId !== undefined) changes.goalId = patch.goalId;
      if (patch.priority !== undefined) changes.priority = patch.priority;
      if (patch.due !== undefined) changes.due = patch.due;
      await db.items.update(id, { ...changes, touchedAt: today });
    }
  });
}

/** Delete: the item goes to the Bin (restorable from the Bin page). */
export async function deleteItem(id: string, today: ISODate): Promise<void> {
  await db.transaction("rw", db.items, async () => {
    const item = await db.items.get(id);
    if (!item || BINNED.includes(item.status)) return;
    await db.items.update(id, { status: "deleted", deletedAt: today, touchedAt: today });
  });
}

/** The Bin: deleted items, newest deletion first. Purged rows never appear. */
export async function listBin(): Promise<Item[]> {
  const bin = await db.items.where("status").equals("deleted").toArray();
  return bin.sort(
    (a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? "") || (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
  );
}

/** Restore from the Bin, in the area it was in: done if it had been done, else open. */
export async function restoreFromBin(id: string, today: ISODate): Promise<void> {
  await db.transaction("rw", db.items, async () => {
    const item = await db.items.get(id);
    if (!item || item.status !== "deleted") return;
    const { deletedAt: _d, ...rest } = item;
    await db.items.put({ ...rest, status: item.completedAt ? "done" : "open", touchedAt: today });
  });
}

/**
 * Empty the Bin, in ONE transaction. Sync never hard-deletes, so each deleted row is
 * replaced by a content-free tombstone (status "purged": no title, notes, links, tags,
 * source or dates beyond createdAt/touchedAt) that syncs like any other change. Deleted
 * goals become tombstones the same way (no title, why, cadence, notes, milestones,
 * deadline, target or source). Pictures on their pages that no other page shows become
 * tombstones too (no image data). Returns how many were emptied (items and goals).
 */
export async function emptyBin(today: ISODate, only?: { items: string[]; goals: string[] }): Promise<number> {
  // With `only` (the rows the confirmation showed), nothing binned since is purged unasked.
  const pickItem = (i: Item) => !only || only.items.includes(i.id);
  const pickGoal = (g: Goal) => !only || only.goals.includes(g.id);
  return db.transaction("rw", db.items, db.goals, db.files, async () => {
    const bin = (await db.items.where("status").equals("deleted").toArray()).filter(pickItem);
    const tombs: Item[] = bin.map((i) => ({
      id: i.id,
      kind: i.kind,
      title: "",
      links: [],
      areaId: i.areaId,
      priority: i.priority,
      status: "purged",
      createdAt: i.createdAt,
      touchedAt: today,
    }));
    if (tombs.length) await db.items.bulkPut(tombs);
    const goals = (await db.goals.toArray()).filter((g) => g.status === "deleted" && pickGoal(g));
    const goalTombs: Goal[] = goals.map((g) => ({
      id: g.id,
      title: "",
      areaId: g.areaId,
      kind: g.kind,
      milestones: [],
      createdAt: g.createdAt,
      status: "purged",
    }));
    if (goalTombs.length) await db.goals.bulkPut(goalTombs);
    await purgePictures([...bin.map((i) => i.notes), ...goals.map((g) => g.notes)]);
    return tombs.length + goalTombs.length;
  });
}

/** Delete a goal: it goes to the Bin. Its tasks keep their goalId (it shows again on restore). */
export async function deleteGoal(id: string, today: ISODate): Promise<void> {
  await db.transaction("rw", db.goals, async () => {
    const goal = await db.goals.get(id);
    if (!goal || goal.status !== undefined) return;
    await db.goals.put({ ...goal, status: "deleted", deletedAt: today });
  });
}

/** Deleted goals in the Bin, newest deletion first. */
export async function listGoalBin(): Promise<Goal[]> {
  const bin = (await db.goals.toArray()).filter((g) => g.status === "deleted");
  return bin.sort(
    (a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? "") || (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
  );
}

/** Restore a goal from the Bin, as it was. */
export async function restoreGoalFromBin(id: string, _today: ISODate): Promise<void> {
  await db.transaction("rw", db.goals, async () => {
    const goal = await db.goals.get(id);
    if (!goal || goal.status !== "deleted") return;
    const { status: _s, deletedAt: _d, ...rest } = goal;
    await db.goals.put(rest);
  });
}

export type SortType = "task" | "idea" | "goal";

/**
 * Files an inbox item from the sort card with the type chosen there: To-do and Idea set
 * the kind and the area (an idea drops due, repeat and day pins); Goal turns it into a
 * practice goal in that area (itemToGoal). Returns the new goal for Goal.
 */
export async function fileItem(id: string, type: SortType, areaId: AreaId, today: ISODate): Promise<Goal | undefined> {
  if (areaId === "inbox" || !(AREA_IDS as readonly string[]).includes(areaId)) {
    throw new Error("choose an area other than the inbox");
  }
  return db.transaction("rw", db.items, db.goals, async () => {
    const item = await db.items.get(id);
    // A stale card (filed or binned elsewhere meanwhile) must not re-file a sorted row.
    if (!item || item.status !== "open" || item.areaId !== "inbox") throw new Error("that item is no longer in the inbox");
    if (type === "goal") return itemToGoal(id, areaId, today);
    if (type === "idea") {
      // An idea has no sessions either (a project added to the inbox, filed as an idea).
      const { due: _d, recur: _r, pinnedDate: _p, hiddenOn: _h, sessions: _s, ...rest } = item;
      await db.items.put({ ...rest, kind: "idea", areaId, touchedAt: today });
    } else {
      await db.items.put({ ...item, kind: "task", areaId, touchedAt: today });
    }
    return undefined;
  });
}

/** Saves an item's notes; blank text removes them. */
export async function saveItemNotes(id: string, notes: string, today: ISODate): Promise<void> {
  await db.transaction("rw", db.items, async () => {
    const item = await db.items.get(id);
    if (!item) return;
    const { notes: _n, ...rest } = item;
    await db.items.put(notes.trim() ? { ...rest, notes, touchedAt: today } : { ...rest, touchedAt: today });
  });
}

/** One item as stored (for an undo snapshot). */
export async function getItem(id: string): Promise<Item | undefined> {
  return db.items.get(id);
}

/** Undo: puts an item back exactly as it was (the change tracker re-stamps it). */
export async function putItemBack(snapshot: Item, today: ISODate): Promise<void> {
  const { updatedAt: _u, ...row } = snapshot;
  await db.items.put({ ...row, touchedAt: today });
}

/**
 * Pictures on pages that were just emptied from the Bin become content-free tombstones,
 * unless another page (anything not purged, the Bin included) still shows them. Runs inside
 * emptyBin's transaction, after the page tombstones are written.
 */
async function purgePictures(pages: (string | undefined)[]): Promise<void> {
  const gone = new Set(pages.flatMap((p) => pictureIds(p ?? "")));
  if (gone.size === 0) return;
  const stillShown = new Set<string>();
  await db.items.each((i) => pictureIds(i.notes ?? "").forEach((id) => stillShown.add(id)));
  await db.goals.each((g) => pictureIds(g.notes ?? "").forEach((id) => stillShown.add(id)));
  const tombs: FileRow[] = [];
  for (const id of gone) {
    if (stillShown.has(id)) continue;
    const f = await db.files.get(id);
    if (!f || f.status === "purged" || f.encrypted === true) continue; // journal photos are never a page's
    tombs.push({ id, mime: f.mime, data: "", width: 0, height: 0, createdAt: f.createdAt, status: "purged" });
  }
  if (tombs.length) await db.files.bulkPut(tombs);
}

/** A picture as stored (undefined until it has arrived on this device). */
export async function getFile(id: string): Promise<FileRow | undefined> {
  const f = await db.files.get(id);
  return f?.encrypted === true ? undefined : f; // a journal photo is never shown on a page
}

/** Stores a new picture for a page; returns its id (the page refers to it as `![](file:<id>)`). */
export async function addPicture(
  picture: { mime: string; data: string; width: number; height: number },
  today: ISODate,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.files.add({
    id, mime: picture.mime, data: picture.data, width: picture.width, height: picture.height, createdAt: today,
  });
  return id;
}
