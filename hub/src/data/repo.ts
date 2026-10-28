import { db } from "./db";
import { addDays, isValidISODate, mondayOf } from "../domain/dates";
import { AREA_IDS, type AreaId, type Goal, type ISODate, type Item, type Milestone } from "../domain/types";

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
  return item;
}

export async function createGoal(
  input: Omit<Goal, "id" | "createdAt" | "milestones"> & { milestones?: Milestone[] },
  today: ISODate,
): Promise<Goal> {
  if (input.kind === "finite" && !input.deadline) {
    throw new Error("finite goals need a deadline");
  }
  const goal: Goal = {
    ...input,
    id: crypto.randomUUID(),
    milestones: input.milestones ?? [],
    createdAt: today,
  };
  await db.goals.add(goal);
  return goal;
}

/** The only goal fields the Edit section may change. */
export interface GoalPatch {
  title?: string;
  areaId?: AreaId;
  deadline?: ISODate | undefined;
  monthlyTarget?: number | undefined;
}

/**
 * Edits a goal's title, area, deadline and monthly target in one transaction, with the
 * same rules as createGoal (a finite goal keeps a real deadline; goals are never in the
 * inbox). A key that is present with the value undefined clears that field. Milestones,
 * source, why, cadence and notes are never touched.
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
    return goal;
  });
}

export async function tickItem(id: string, today: ISODate): Promise<void> {
  await db.transaction("rw", db.items, async () => {
    const item = await db.items.get(id);
    if (!item || item.status === "done") return;
    await db.items.update(id, { status: "done", completedAt: today, touchedAt: today });
  });
}

export async function untickItem(id: string, today: ISODate): Promise<void> {
  await db.transaction("rw", db.items, async () => {
    const item = await db.items.get(id);
    if (!item) return;
    const { completedAt: _drop, ...rest } = item;
    await db.items.put({ ...rest, status: "open", touchedAt: today });
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

export async function listItems(
  filter: {
    areaId?: AreaId;
    goalId?: string;
    status?: Item["status"];
    kind?: Item["kind"];
  } = {},
): Promise<Item[]> {
  const all = await db.items.toArray();
  return all.filter(
    (i) =>
      (filter.status ? i.status === filter.status : i.status !== "archived") &&
      (!filter.areaId || i.areaId === filter.areaId) &&
      (!filter.goalId || i.goalId === filter.goalId) &&
      (!filter.kind || i.kind === filter.kind),
  );
}

export async function listGoals(): Promise<Goal[]> {
  return db.goals.toArray();
}

export async function toggleMilestone(goalId: string, milestoneId: string): Promise<void> {
  await db.transaction("rw", db.goals, async () => {
    const goal = await db.goals.get(goalId);
    if (!goal) return;
    await db.goals.update(goalId, {
      milestones: goal.milestones.map((m) => (m.id === milestoneId ? { ...m, done: !m.done } : m)),
    });
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
