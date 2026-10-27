import { db } from "./db";
import { addDays, mondayOf } from "../domain/dates";
import type { AreaId, Goal, ISODate, Item, Milestone } from "../domain/types";

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

export async function updateItem(id: string, patch: Partial<Item>, today: ISODate): Promise<void> {
  await db.items.update(id, { ...patch, touchedAt: today });
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
    else next.weekOf = mondayOf(today);
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
