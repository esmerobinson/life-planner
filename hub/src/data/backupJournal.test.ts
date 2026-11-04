import { db } from "./db";
import { exportBackup, INVALID_BACKUP, NEWER_BACKUP, parseBackup, restoreBackup } from "./backup";
import { listNoteReads, listNotes, saveNote, saveNoteDraft, setNoteRead } from "./repo";
import { toBase64, type JournalKey } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";

// Backups carry every journal row (review I3): notes and their reads, notes in progress, and
// rows this version can't read yet (held in quarantine). A file whose only news is a journal kind
// this version doesn't know is restored, those rows kept for later, never called damaged.
// Fictional words only.

const DAY = "2026-11-04";
const ME = "device-mac-0001";
const NOTE = { prompt: null, thought: "Pretend thought", steady: "Pretend steady words", memory: "", skill: "" };
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-journal-backup");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear(), db.items.clear(), db.goals.clear(), db.files.clear()]);
  await confirmedDevice(db, jk);
});

const FP = "0123456789abcdef";
/** A sealed row of a kind a later app version has (its shape is the usual sealed one). */
const future = (id = `future-kind:${DAY}:pretend-0001`) => ({
  id, kind: "future-kind", date: DAY, fp: FP, iv: toBase64(new Uint8Array(12)), ct: "AAAAAAAAAAAAAAAAAAAAAA==", updatedAt: 5,
});
const roundTrip = async () => JSON.parse(JSON.stringify(await exportBackup(DAY)));

it("notes, their read ticks and a note in progress go into the backup sealed and come back on restore", async () => {
  const id = await saveNote(jk, DAY, ME, NOTE);
  await setNoteRead(jk, DAY, ME, id, true);
  const other = await saveNote(jk, DAY, ME, { ...NOTE, thought: "Pretend other thought" });
  await saveNoteDraft(jk, ME, other, { ...NOTE, thought: "Pretend other thought", steady: "Pretend half typed" }, (await listNotes(jk)).notes[1]!.seen);
  const file = await roundTrip();
  expect(file.journal.map((r: { kind: string }) => r.kind).sort()).toEqual(["note", "note", "note", "note-read", "verifier"]);
  expect(JSON.stringify(file)).not.toContain("Pretend");
  await db.journal.clear();
  await restoreBackup(file, "replace");
  const { notes, drafts } = await listNotes(jk, ME);
  expect(notes.map((n) => n.thought)).toEqual(["Pretend thought", "Pretend other thought"]);
  expect(drafts.map((d) => d.fields.steady)).toEqual(["Pretend half typed"]);
  expect((await listNoteReads(jk)).ownOn(DAY, ME)).toEqual(new Set([id]));
});

it("rows held in quarantine (this version can't read them yet) are in the backup too", async () => {
  const row = future();
  await db.quarantine.put({ table: "journal", id: row.id, updatedAt: 5, data: row, reason: "pretend", cursor: 1 });
  await db.quarantine.put({ table: "later-table", id: "x", updatedAt: 5, data: { id: "x" }, reason: "pretend", cursor: 1 });
  const file = await roundTrip();
  expect(file.journal).toContainEqual(row);
  expect(file.journal.some((r: { id: string }) => r.id === "x")).toBe(false);
});

it("a backup with a journal kind this version doesn't know restores: those rows are kept for later, not called damaged", async () => {
  await saveNote(jk, DAY, ME, NOTE);
  const file = await roundTrip();
  const row = future();
  file.journal.push(row);
  expect(() => parseBackup(file)).not.toThrow();
  await db.journal.clear();
  const r = await restoreBackup(file, "replace");
  expect(r.kept).toBe(1);
  expect(await db.journal.get(row.id)).toBeUndefined();
  expect(await db.quarantine.get(["journal", row.id])).toMatchObject({ table: "journal", id: row.id, updatedAt: 5, data: row });
  expect((await listNotes(jk)).notes).toHaveLength(1);
  // Merging the same file again keeps one copy.
  expect((await restoreBackup(file, "merge")).kept).toBe(1);
  expect(await db.quarantine.count()).toBe(1);
});

it("an unknown kind with something typed in clear (not sealed) is still refused", async () => {
  const file = await roundTrip();
  file.journal.push({ ...future(), text: "Pretend plaintext" });
  expect(() => parseBackup(file)).toThrow(NEWER_BACKUP);
});

it("a file from a newer version this one can't read says so; a file that isn't a backup says that, kindly", async () => {
  const file = await roundTrip();
  file.items.push({ id: "pretend", kind: "a-kind-from-later" });
  expect(() => parseBackup(file)).toThrow(NEWER_BACKUP);
  expect(() => parseBackup("{not json")).toThrow(INVALID_BACKUP);
  expect(() => parseBackup({ app: "something-else" })).toThrow(INVALID_BACKUP);
  expect(INVALID_BACKUP).not.toMatch(/damaged/);
  expect(INVALID_BACKUP).toMatch(/not an Esmeworld backup/); // the Backup page's own test reads this
});
