import { isValidISODate } from "../domain/dates";
import { db } from "./db";
import { AREA_IDS, type Goal, type ISODate, type Item } from "../domain/types";

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

/** Shown when the write itself fails; the transaction leaves the data as it was. */
export const RESTORE_FAILED = "The restore did not work. Nothing was changed.";

const AREAS: readonly string[] = AREA_IDS;
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
    isStr(r.createdAt) && isValidISODate(r.createdAt) &&
    isStr(r.touchedAt) && isValidISODate(r.touchedAt) &&
    optStr(r.notes) &&
    optStrArray(r.tags) &&
    optStr(r.goalId) &&
    optDate(r.due) &&
    (r.recur === undefined || (Array.isArray(r.recur) && r.recur.every((d) => WEEKDAYS.includes(d as string)))) &&
    optDate(r.pinnedDate) &&
    optDate(r.weekOf) &&
    optDate(r.hiddenOn) &&
    optDate(r.completedAt) &&
    validSource(r.source)
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
    isStr(r.createdAt) && isValidISODate(r.createdAt) &&
    optDate(r.deadline) &&
    (r.monthlyTarget === undefined ||
      (typeof r.monthlyTarget === "number" && Number.isFinite(r.monthlyTarget) && r.monthlyTarget > 0))
  );
}

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
/** Absent, or a real "YYYY-MM-DD" date. */
const optDate = (v: unknown) => v === undefined || (isStr(v) && isValidISODate(v));
const optStr = (v: unknown) => v === undefined || isStr(v);
const optStrArray = (v: unknown) => v === undefined || isStrArray(v);

function validSource(v: unknown) {
  if (v === undefined) return true;
  return isObj(v) && (v.kind === "backlog" || v.kind === "manual") && isStr(v.key);
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
    !isValidISODate(data.exportedOn) ||
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
  try {
    return await writeBackup(file, mode);
  } catch {
    // The transaction aborted, so nothing was written.
    throw new Error(RESTORE_FAILED);
  }
}

async function writeBackup(file: BackupFile, mode: "merge" | "replace") {
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
