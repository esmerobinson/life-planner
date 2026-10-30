import { db } from "./db";
import { MAX_GOAL_NOTES, MAX_GOAL_TEXT } from "./validate";
import { pictureIds } from "../domain/page";
import { addDays, isValidISODate, mondayOf } from "../domain/dates";
import { isHabit, withDoneDate, withoutDoneDate } from "../domain/habits";
import { milestoneTask } from "../domain/milestones";
export * from "./journalRepo";
import { AREA_IDS, type AreaId, type FileRow, type Goal, type ISODate, type Item, type Milestone } from "../domain/types";

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
      const { due: _d, recur: _r, pinnedDate: _p, hiddenOn: _h, ...rest } = item;
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
    if (!f || f.status === "purged") continue;
    tombs.push({ id, mime: f.mime, data: "", width: 0, height: 0, createdAt: f.createdAt, status: "purged" });
  }
  if (tombs.length) await db.files.bulkPut(tombs);
}

/** A picture as stored (undefined until it has arrived on this device). */
export async function getFile(id: string): Promise<FileRow | undefined> {
  return db.files.get(id);
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
