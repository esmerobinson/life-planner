import { isValidISODate } from "../domain/dates";
import { db } from "./db";
import { keepOwnStamps } from "./changeTracking";
import { mergeBlocked, readSyncGate, REPLACE_OFF_WHILE_SYNCING, replaceBlocked, WAITING_FIRST_SYNC, withSyncLock } from "./syncGate";
import type { FileRow, Goal, ISODate, Item, JournalRow } from "../domain/types";
import { isObj, isStr, validFile, validGoal, validItem, validJournal } from "./validate";

export { validFile, validGoal, validItem, validJournal };

export interface BackupFile {
  app: "life-hub";
  schema: 1;
  exportedOn: ISODate;
  items: Item[];
  goals: Goal[];
  /** Pictures on pages (round 3b). Optional: older backups have none and still load. */
  files?: FileRow[];
  /**
   * The journal (journal round), exactly as stored: sealed rows only, never plaintext.
   * Optional: older backups have none and still load.
   */
  journal?: JournalRow[];
}

/** The one message for any file that is not a usable backup. */
export const INVALID_BACKUP =
  "That file is not an Esmeworld backup, or it is damaged. Nothing was changed.";

/** Shown when the write itself fails; the transaction leaves the data as it was. */
export const RESTORE_FAILED = "The restore did not work. Nothing was changed.";

/** Rows emptied from the Bin stay in files as tombstones but are never counted for the person. */
const notPurged = (r: Item | Goal) => r.status !== "purged";

const hasDuplicateIds =(rows: { id: string }[]) => new Set(rows.map((r) => r.id)).size !== rows.length;

/** Checks the whole file before anything is written. Throws INVALID_BACKUP. */
export function parseBackup(raw: unknown): BackupFile {
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
    hasDuplicateIds(data.goals as Goal[]) ||
    (data.files !== undefined &&
      (!Array.isArray(data.files) || !data.files.every(validFile) || hasDuplicateIds(data.files as FileRow[]))) ||
    (data.journal !== undefined &&
      (!Array.isArray(data.journal) || !data.journal.every(validJournal) || hasDuplicateIds(data.journal as JournalRow[])))
  ) {
    throw new Error(INVALID_BACKUP);
  }
  return data as unknown as BackupFile;
}

export async function exportBackup(today: ISODate): Promise<BackupFile> {
  return db.transaction("r", [db.items, db.goals, db.files, db.journal], async () => ({
    app: "life-hub" as const,
    schema: 1 as const,
    exportedOn: today,
    items: await db.items.toArray(),
    goals: await db.goals.toArray(),
    files: await db.files.toArray(),
    journal: await db.journal.toArray(),
  }));
}

export async function restoreBackup(
  raw: unknown,
  mode: "merge" | "replace",
): Promise<{ addedItems: number; addedGoals: number; skipped: number }> {
  const file = parseBackup(raw); // nothing is written until every row has passed
  try {
    // Holding the sync lock: no sync run is in flight while the restore writes.
    return await withSyncLock(db, () => writeBackup(file, mode));
  } catch (err) {
    // The transaction aborted, so nothing was written.
    if (err instanceof Error && (err.message === WAITING_FIRST_SYNC || err.message === REPLACE_OFF_WHILE_SYNCING)) throw err;
    throw new Error(RESTORE_FAILED);
  }
}

async function writeBackup(file: BackupFile, mode: "merge" | "replace") {
  return db.transaction("rw", [db.items, db.goals, db.files, db.journal, db.syncMeta], async () => {
    // Restored rows keep the file's own stamp (its updatedAt, else createdAt), never "now":
    // a copy the server already has, edited since on another device, wins over them.
    keepOwnStamps();
    const gate = await readSyncGate(db.syncMeta);
    if (mode === "replace" && replaceBlocked(gate)) throw new Error(REPLACE_OFF_WHILE_SYNCING);
    if (mode === "merge" && mergeBlocked(gate)) throw new Error(WAITING_FIRST_SYNC);
    if (mode === "replace") {
      await db.items.clear();
      await db.goals.clear();
      await db.files.clear();
      await db.journal.clear();
      // Sync never deletes, so rows removed here still exist on the server. Pulling from
      // the start again brings them back instead of leaving this device silently missing
      // them.
      await db.syncMeta.put({ key: "cursor", value: 0 });
      await db.syncMeta.delete("firstPullDone");
      await db.items.bulkAdd(file.items);
      await db.goals.bulkAdd(file.goals);
      await db.files.bulkAdd(file.files ?? []);
      await db.journal.bulkAdd(file.journal ?? []);
      return { addedItems: file.items.filter(notPurged).length, addedGoals: file.goals.filter(notPurged).length, skipped: 0 };
    }
    const haveItems = new Set(await db.items.toCollection().primaryKeys());
    const haveGoals = new Set(await db.goals.toCollection().primaryKeys());
    const newItems = file.items.filter((i) => !haveItems.has(i.id));
    const newGoals = file.goals.filter((g) => !haveGoals.has(g.id));
    await db.items.bulkAdd(newItems);
    await db.goals.bulkAdd(newGoals);
    // Pictures: only the missing ones (they are never edited, so a copy here is the same picture).
    const haveFiles = new Set(await db.files.toCollection().primaryKeys());
    await db.files.bulkAdd((file.files ?? []).filter((f) => !haveFiles.has(f.id)));
    // Journal entries: only the missing ones (an entry already here is this device's own copy).
    const haveJournal = new Set(await db.journal.toCollection().primaryKeys());
    await db.journal.bulkAdd((file.journal ?? []).filter((j) => !haveJournal.has(j.id)));
    const fileVisible = file.items.filter(notPurged).length;
    const addedVisible = newItems.filter(notPurged).length;
    const fileGoalsVisible = file.goals.filter(notPurged).length;
    const addedGoalsVisible = newGoals.filter(notPurged).length;
    return {
      addedItems: addedVisible,
      addedGoals: addedGoalsVisible,
      skipped: fileVisible - addedVisible + (fileGoalsVisible - addedGoalsVisible),
    };
  });
}
