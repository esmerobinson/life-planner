import { db } from "./db";
import type { Goal, ISODate, Item } from "../domain/types";

export interface BackupFile {
  app: "life-hub";
  schema: 1;
  exportedOn: ISODate;
  items: Item[];
  goals: Goal[];
}

/** The one message for any file that is not a usable backup. */
export const INVALID_BACKUP =
  "That file is not a Life Hub backup, or it is damaged. Nothing was changed.";

const AREAS = ["writing", "art", "content", "mind", "body", "inbox"];
const ITEM_KINDS = ["task", "idea"];
const STATUSES = ["open", "done", "archived"];
const GOAL_KINDS = ["finite", "practice"];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isStrArray = (v: unknown) => Array.isArray(v) && v.every(isStr);

function validItem(r: unknown): r is Item {
  return (
    isObj(r) &&
    isStr(r.id) && r.id !== "" &&
    ITEM_KINDS.includes(r.kind as string) &&
    isStr(r.title) &&
    isStrArray(r.links) &&
    AREAS.includes(r.areaId as string) &&
    (r.priority === 1 || r.priority === 2 || r.priority === 3) &&
    STATUSES.includes(r.status as string) &&
    isStr(r.createdAt) &&
    isStr(r.touchedAt)
  );
}

function validGoal(r: unknown): r is Goal {
  return (
    isObj(r) &&
    isStr(r.id) && r.id !== "" &&
    isStr(r.title) &&
    AREAS.includes(r.areaId as string) &&
    GOAL_KINDS.includes(r.kind as string) &&
    Array.isArray(r.milestones) &&
    r.milestones.every(
      (m) => isObj(m) && isStr(m.id) && isStr(m.title) && typeof m.done === "boolean",
    ) &&
    isStr(r.createdAt)
  );
}

const hasDuplicateIds = (rows: { id: string }[]) => new Set(rows.map((r) => r.id)).size !== rows.length;

/** Checks the whole file before anything is written. Throws INVALID_BACKUP. */
function parseBackup(raw: unknown): BackupFile {
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(INVALID_BACKUP);
    }
  }
  if (
    !isObj(data) ||
    data.app !== "life-hub" ||
    data.schema !== 1 ||
    !isStr(data.exportedOn) ||
    !Array.isArray(data.items) ||
    !Array.isArray(data.goals) ||
    !data.items.every(validItem) ||
    !data.goals.every(validGoal) ||
    hasDuplicateIds(data.items as Item[]) ||
    hasDuplicateIds(data.goals as Goal[])
  ) {
    throw new Error(INVALID_BACKUP);
  }
  return data as unknown as BackupFile;
}

export async function exportBackup(today: ISODate): Promise<BackupFile> {
  return db.transaction("r", db.items, db.goals, async () => ({
    app: "life-hub" as const,
    schema: 1 as const,
    exportedOn: today,
    items: await db.items.toArray(),
    goals: await db.goals.toArray(),
  }));
}

export async function restoreBackup(
  raw: unknown,
  mode: "merge" | "replace",
): Promise<{ addedItems: number; addedGoals: number; skipped: number }> {
  const file = parseBackup(raw); // nothing is written until every row has passed
  return db.transaction("rw", db.items, db.goals, async () => {
    if (mode === "replace") {
      await db.items.clear();
      await db.goals.clear();
      await db.items.bulkAdd(file.items);
      await db.goals.bulkAdd(file.goals);
      return { addedItems: file.items.length, addedGoals: file.goals.length, skipped: 0 };
    }
    const haveItems = new Set(await db.items.toCollection().primaryKeys());
    const haveGoals = new Set(await db.goals.toCollection().primaryKeys());
    const newItems = file.items.filter((i) => !haveItems.has(i.id));
    const newGoals = file.goals.filter((g) => !haveGoals.has(g.id));
    await db.items.bulkAdd(newItems);
    await db.goals.bulkAdd(newGoals);
    return {
      addedItems: newItems.length,
      addedGoals: newGoals.length,
      skipped: file.items.length - newItems.length + (file.goals.length - newGoals.length),
    };
  });
}
