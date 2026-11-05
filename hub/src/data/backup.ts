import { isValidISODate } from "../domain/dates";
import { db } from "./db";
import { keepOwnStamps } from "./changeTracking";
import { retireDeviceId } from "./deviceIds";
import { mergeBlocked, readSyncGate, REPLACE_OFF_WHILE_SYNCING, replaceBlocked, WAITING_FIRST_SYNC, withSyncLock } from "./syncGate";
import { JOURNAL_KINDS, type FileRow, type Goal, type ISODate, type Item, type JournalRow } from "../domain/types";
import { isObj, isStr, sealedJournalShape, validFile, validGoal, validItem, validJournal } from "./validate";
import { FARM_KINDS, validFarm, type FarmRow } from "../farm/state";
import { JOURNAL_KEY_META, VERIFIER_ID } from "../journal/keyStore";

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
  /** Esme's Farm's own state (farm/state.ts). Optional: older backups have none and still load. */
  farm?: FarmRow[];
  /**
   * The ids of rows in `farm` that the version making the backup couldn't read and held for a
   * later version (bug #48). Restoring holds them again; a farm row this version can't read and
   * the file doesn't name is from a newer version (NEWER_BACKUP, bug #47).
   */
  farmHeld?: string[];
}

/** For a file that isn't a backup this app can read at all. */
export const INVALID_BACKUP =
  "That file is not an Esmeworld backup, or it couldn't be read. Nothing has changed: everything is just as it was.";

/**
 * For an Esmeworld backup with something in it this version can't read: almost always a backup
 * made by a newer version (review I3). Honest for a damaged one too.
 */
export const NEWER_BACKUP =
  "Part of that backup can't be read by this version of Esmeworld. If the app has an update waiting, update it, then try again. Nothing has changed.";

/**
 * Placeholder wording (Esme may reword; journal-rekey report): Replace with a backup whose
 * journal is ANOTHER one (its check row carries another key's fingerprint). Restoring it would
 * lock her own journal on every device once it synced (bug #35), so nothing is restored.
 */
export const FOREIGN_JOURNAL_BACKUP =
  "This backup holds a different journal from the one on this device, so nothing was restored. Your journal, tasks and goals are just as they were.";

/** Shown when the write itself fails; the transaction leaves the data as it was. */
export const RESTORE_FAILED = "The restore did not work. Nothing was changed.";

/** Rows emptied from the Bin stay in files as tombstones but are never counted for the person. */
const notPurged = (r: Item | Goal) => r.status !== "purged";

const hasDuplicateIds =(rows: { id: string }[]) => new Set(rows.map((r) => r.id)).size !== rows.length;

/**
 * A farm row only a later version reads: a plain row with its id and a kind this version doesn't
 * have (or one held for later, named in `farmHeld`, checked by parseBackup). A row of a kind this
 * version has that doesn't check out is damaged.
 */
const farmLater = (r: unknown, held: ReadonlySet<string>): boolean =>
  isObj(r) && isStr(r.id) && r.id !== "" && r.id.length <= 128 && isStr(r.kind) &&
  (r.updatedAt === undefined || (typeof r.updatedAt === "number" && Number.isSafeInteger(r.updatedAt) && r.updatedAt > 0)) &&
  (!(FARM_KINDS as readonly string[]).includes(r.kind) || held.has(r.id));

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
  if (!isObj(data) || data.app !== "life-hub" || data.schema !== 1) throw new Error(INVALID_BACKUP);
  if (!isStr(data.exportedOn) || !isValidISODate(data.exportedOn) || !Array.isArray(data.items) || !Array.isArray(data.goals)) {
    throw new Error(INVALID_BACKUP);
  }
  // Damaged (re-review m5d): repeated ids, a picture that isn't one, a journal row that isn't
  // sealed, or one of a kind this version knows that doesn't check out.
  const known = (r: JournalRow) => (JOURNAL_KINDS as readonly string[]).includes(r.kind);
  const farmHeld = new Set(Array.isArray(data.farmHeld) ? data.farmHeld.filter(isStr) : []);
  if (
    hasDuplicateIds(data.items as Item[]) ||
    hasDuplicateIds(data.goals as Goal[]) ||
    (data.files !== undefined &&
      (!Array.isArray(data.files) || !data.files.every(validFile) || hasDuplicateIds(data.files as FileRow[]))) ||
    (data.journal !== undefined &&
      (!Array.isArray(data.journal) ||
        !data.journal.every((r) => sealedJournalShape(r) && (!known(r) || validJournal(r))) ||
        hasDuplicateIds(data.journal as JournalRow[]))) ||
    (data.farm !== undefined &&
      (!Array.isArray(data.farm) || !data.farm.every((r) => validFarm(r) || farmLater(r, farmHeld)) || hasDuplicateIds(data.farm as FarmRow[]))) ||
    (data.farmHeld !== undefined && (!Array.isArray(data.farmHeld) || !data.farmHeld.every(isStr)))
  ) {
    throw new Error(INVALID_BACKUP);
  }
  // A task or goal this version can't read (a new area, say): most likely made by a newer one.
  // A journal kind only a later version knows is kept as it is (sealed), never "damaged".
  if (!data.items.every(validItem) || !data.goals.every(validGoal)) throw new Error(NEWER_BACKUP);
  // A farm row this version can't read: held again if the backup's own version held it, else
  // the file is from a newer version (bug #47; never "not a backup").
  if (((data.farm as unknown[] | undefined) ?? []).some((r) => !validFarm(r) && !farmHeld.has((r as { id: string }).id))) {
    throw new Error(NEWER_BACKUP);
  }
  return data as unknown as BackupFile;
}

export async function exportBackup(today: ISODate): Promise<BackupFile> {
  return db.transaction("r", [db.items, db.goals, db.files, db.journal, db.farm, db.quarantine], async () => {
    const journal = new Map((await db.journal.toArray()).map((r) => [r.id, r] as const));
    // Journal rows this version can't read yet are in the backup too, as they arrived (review
    // I3), and a held copy newer than the one here takes its place (re-review m5b).
    const held = (await db.quarantine.where("[table+id]").between(["journal", ""], ["journal", "\uffff"]).toArray())
      .map((q): unknown => ({ ...q.data, id: q.id, updatedAt: q.updatedAt }))
      .filter((r): r is JournalRow => sealedJournalShape(r));
    for (const r of held) {
      const here = journal.get(r.id);
      if (!here || (r.updatedAt ?? 0) > (here.updatedAt ?? 0)) journal.set(r.id, r);
    }
    // Farm rows held for a later version are in it too, named in `farmHeld` (bug #48).
    const farm = new Map<string, FarmRow>((await db.farm.toArray()).map((r) => [r.id, r]));
    const farmHeld: string[] = [];
    for (const q of await db.quarantine.where("[table+id]").between(["farm", ""], ["farm", "\uffff"]).toArray()) {
      const r = { ...q.data, id: q.id, updatedAt: q.updatedAt } as unknown as FarmRow;
      const here = farm.get(q.id);
      if (here && (here.updatedAt ?? 0) >= q.updatedAt) continue;
      farm.set(q.id, r);
      if (!validFarm(r)) farmHeld.push(q.id);
    }
    return {
      app: "life-hub" as const,
      schema: 1 as const,
      exportedOn: today,
      items: await db.items.toArray(),
      goals: await db.goals.toArray(),
      files: await db.files.toArray(),
      journal: [...journal.values()],
      farm: [...farm.values()],
      ...(farmHeld.length ? { farmHeld } : {}),
    };
  });
}

export async function restoreBackup(
  raw: unknown,
  mode: "merge" | "replace",
): Promise<{ addedItems: number; addedGoals: number; skipped: number; kept?: number }> {
  const file = parseBackup(raw); // nothing is written until every row has passed
  try {
    // Holding the sync lock: no sync run is in flight while the restore writes.
    return await withSyncLock(db, () => writeBackup(file, mode));
  } catch (err) {
    // The transaction aborted, so nothing was written.
    if (err instanceof Error && [WAITING_FIRST_SYNC, REPLACE_OFF_WHILE_SYNCING, FOREIGN_JOURNAL_BACKUP].includes(err.message)) throw err;
    throw new Error(RESTORE_FAILED);
  }
}

async function writeBackup(file: BackupFile, mode: "merge" | "replace") {
  // Journal rows of a kind this version doesn't know wait in quarantine, applied after the update.
  let known = (file.journal ?? []).filter(validJournal);
  const later = (file.journal ?? []).filter((r) => !validJournal(r));
  // Farm rows the backup's version held for later are held again (bug #48).
  const farmKnown = (file.farm ?? []).filter(validFarm);
  const farmLaterRows = (file.farm ?? []).filter((r: FarmRow): boolean => !validFarm(r as unknown));
  return db.transaction("rw", [db.items, db.goals, db.files, db.journal, db.farm, db.syncMeta, db.quarantine], async () => {
    // Restored rows keep the file's own stamp (its updatedAt, else createdAt), never "now":
    // a copy the server already has, edited since on another device, wins over them.
    keepOwnStamps();
    const gate = await readSyncGate(db.syncMeta);
    if (mode === "replace" && replaceBlocked(gate)) throw new Error(REPLACE_OFF_WHILE_SYNCING);
    if (mode === "merge" && mergeBlocked(gate)) throw new Error(WAITING_FIRST_SYNC);
    // Another journal's check row never comes in (bug #35): it would win on the server and
    // lock this journal on every device. Replace refuses the whole file; Merge leaves it out.
    const ours = await journalFingerprintHere();
    const theirs = known.find((r) => r.id === VERIFIER_ID);
    if (ours && theirs && theirs.fp !== ours) {
      if (mode === "replace") throw new Error(FOREIGN_JOURNAL_BACKUP);
      known = known.filter((r) => r !== theirs);
    }
    if (mode === "replace") {
      await db.items.clear();
      await db.goals.clear();
      await db.files.clear();
      await db.journal.clear();
      // An older backup has no farm: the farm here is kept rather than reset (its stickers are
      // derived from the data anyway; nothing of the farm is ever lost).
      if (file.farm !== undefined) await db.farm.clear();
      // Sync never deletes, so rows removed here still exist on the server. Pulling from
      // the start again brings them back instead of leaving this device silently missing
      // them.
      await db.syncMeta.put({ key: "cursor", value: 0 });
      await db.syncMeta.delete("firstPullDone");
      // The server may have newer copies of this device's own journal rows than the file (words
      // written after the backup). From now on the device writes with a new id, beside them,
      // never over them: an edit made before the next sync can't win over words it never saw
      // (bug #31, deviceIds.ts). The rows restored here keep the file's stamps, so a newer copy wins.
      await retireDeviceId(db.syncMeta);
      await db.items.bulkAdd(file.items);
      await db.goals.bulkAdd(file.goals);
      await db.files.bulkAdd(file.files ?? []);
      await db.journal.bulkAdd(known);
      await db.farm.bulkAdd(farmKnown);
      await holdForLater(later);
      await holdFarmForLater(farmLaterRows);
      return { addedItems: file.items.filter(notPurged).length, addedGoals: file.goals.filter(notPurged).length, skipped: 0, ...keptCount(later, farmLaterRows) };
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
    await db.journal.bulkAdd(known.filter((j) => !haveJournal.has(j.id)));
    // The farm: only the missing facts (a row already here is this device's own, or newer).
    const haveFarm = new Set(await db.farm.toCollection().primaryKeys());
    await db.farm.bulkAdd(farmKnown.filter((f) => !haveFarm.has(f.id)));
    await holdForLater(later);
    await holdFarmForLater(farmLaterRows.filter((f) => !haveFarm.has(f.id)));
    const fileVisible = file.items.filter(notPurged).length;
    const addedVisible = newItems.filter(notPurged).length;
    const fileGoalsVisible = file.goals.filter(notPurged).length;
    const addedGoalsVisible = newGoals.filter(notPurged).length;
    return {
      addedItems: addedVisible,
      addedGoals: addedGoalsVisible,
      skipped: fileVisible - addedVisible + (fileGoalsVisible - addedGoalsVisible),
      ...keptCount(later, farmLaterRows.filter((f) => !haveFarm.has(f.id))),
    };
  });
}

/**
 * This device's journal, by its key's fingerprint: the confirmed key's, else the verifier row's
 * here (a locked device). Undefined when neither is here (nothing to compare with). In the
 * caller's transaction (syncMeta and journal).
 */
async function journalFingerprintHere(): Promise<string | undefined> {
  const confirmed = (await db.syncMeta.get(JOURNAL_KEY_META))?.value as { fp?: unknown } | undefined;
  if (typeof confirmed?.fp === "string") return confirmed.fp;
  return (await db.journal.get(VERIFIER_ID))?.fp;
}

/** How many rows wait for a newer version (said only when there are some). */
const keptCount = (later: JournalRow[], farm: unknown[] = []) => (later.length + farm.length ? { kept: later.length + farm.length } : {});

/** Farm rows only a later version reads, kept in quarantine (a newer copy already held stays). */
async function holdFarmForLater(rows: FarmRow[]) {
  for (const r of rows) {
    const updatedAt = typeof r.updatedAt === "number" ? r.updatedAt : 0;
    const held = await db.quarantine.get(["farm", r.id]);
    if (held && held.updatedAt > updatedAt) continue;
    await db.quarantine.put({
      table: "farm", id: r.id, updatedAt, data: r as unknown as Record<string, unknown>,
      reason: "From a backup: a later version of the app reads it.", cursor: 0, fromBackup: true,
    });
  }
}

/** Rows only a newer version reads, kept in quarantine (a newer copy already held stays). */
async function holdForLater(rows: JournalRow[]) {
  for (const r of rows) {
    const updatedAt = typeof r.updatedAt === "number" ? r.updatedAt : 0;
    const held = await db.quarantine.get(["journal", r.id]);
    if (held && held.updatedAt > updatedAt) continue;
    await db.quarantine.put({
      table: "journal", id: r.id, updatedAt, data: r as unknown as Record<string, unknown>,
      reason: "From a backup: a later version of the app reads it.", cursor: 0, fromBackup: true,
    });
  }
}
