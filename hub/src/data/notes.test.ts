import { vi } from "vitest";
import { db } from "./db";
import {
  CANT_OPEN, clearNoteDraft, deleteNote, listNoteReads, listNotes, newNoteId, NOT_CONFIRMED, saveNote, saveNoteDraft, setNoteRead,
} from "./repo";
import { journalId, validJournal } from "./validate";
import { journalAad, openJson, sealJson, toBase64, type JournalKey } from "../journal/crypto";
import { JOURNAL_KEY_META } from "../journal/keyStore";
import { confirmedDevice, keyFor } from "../test/journalKey";

// Notes to myself (journal v3): each device's version of a note is its own sealed row
// `note:<date>:<nid>_<deviceId>` (its note in progress `…_draft`), and each
// device's "I read this today" ticks for a day are its own row `note-read:<date>:<deviceId>`.
// Written only through the confirmed-key gate; always readable (no 28-day lock). Fictional
// words only.

const DAY = "2026-11-04";
const ME = "device-mac-0001";
const PHONE = "device-phone-01";
const PRETEND = { prompt: "Pretend prompt one", thought: "Pretend worry about a pretend thing", steady: "Pretend steady answer", memory: "", skill: "" };
let jk: JournalKey;
let other: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-journal-one");
  other = await keyFor("fake-journal-two");
});

let clock = 1_800_000_000_000;
beforeEach(async () => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock++);
  await Promise.all([db.journal.clear(), db.pending.clear(), db.syncMeta.clear()]);
  await confirmedDevice(db, jk);
});
afterEach(() => vi.restoreAllMocks());

const IV16 = toBase64(new Uint8Array(12));
const FP = "0123456789abcdef";
const row = (o: Record<string, unknown>) => ({ date: DAY, fp: FP, iv: IV16, ct: "AAAAAAAAAAAAAAAAAAAAAA==", ...o });

describe("row ids", () => {
  it("note:<date>:<nid>_<deviceId>, its _draft and note-read:<date>:<deviceId> are valid journal rows; other shapes are not", () => {
    const nid = "0123456789abcdef";
    expect(validJournal(row({ id: `note:${DAY}:${nid}_${ME}`, kind: "note" }))).toBe(true);
    expect(validJournal(row({ id: `note:${DAY}:${nid}_${ME}_draft`, kind: "note" }))).toBe(true);
    expect(validJournal(row({ id: `note:${DAY}:${nid}_3f2a1b4c-0000-4000-8000-000000000001_draft`, kind: "note" }))).toBe(true);
    expect(validJournal(row({ id: `note-read:${DAY}:${ME}`, kind: "note-read" }))).toBe(true);
    expect(validJournal(row({ id: `note:${DAY}`, kind: "note" }))).toBe(false);
    expect(validJournal(row({ id: `note:2026-11-03:${nid}_${ME}`, kind: "note" }))).toBe(false);
    expect(validJournal(row({ id: `note-read:${DAY}:${ME}`, kind: "note" }))).toBe(false);
    expect(validJournal(row({ id: `note:${DAY}:${nid}_${ME}`, kind: "note", text: "plaintext by mistake" }))).toBe(false);
  });
});

describe("notes", () => {
  it("saves a note sealed (nothing typed in clear) on this device's own row and lists it back", async () => {
    const id = await saveNote(jk, DAY, ME, PRETEND);
    expect(id).toMatch(new RegExp(`^note:${DAY}:[0-9a-f]{16}$`));
    const stored = await db.journal.get(`${id}_${ME}`);
    expect(stored).toMatchObject({ kind: "note", date: DAY, fp: jk.fp });
    expect(JSON.stringify(stored)).not.toContain("Pretend");
    expect(await db.pending.get(["journal", `${id}_${ME}`])).toBeTruthy(); // it syncs
    const { notes, unreadable } = await listNotes(jk);
    expect(unreadable).toBe(0);
    expect(notes).toEqual([{ id, date: DAY, ...PRETEND, createdAt: expect.any(Number), at: expect.any(Number), seen: [expect.any(String)], others: [] }]);
  });

  it("an own thought has no prompt; the optional fields are kept", async () => {
    const id = await saveNote(jk, DAY, ME, { prompt: null, thought: "Pretend own thought", steady: "Pretend own answer", memory: "Pretend memory", skill: "Pretend skill" });
    expect((await listNotes(jk)).notes[0]).toMatchObject({ id, prompt: null, memory: "Pretend memory", skill: "Pretend skill" });
  });

  it("editing writes this device's version again (its day and first-written time kept)", async () => {
    const id = await saveNote(jk, "2026-11-01", ME, PRETEND);
    const first = (await listNotes(jk)).notes[0]!;
    await saveNote(jk, DAY, ME, { ...PRETEND, steady: "Pretend steadier answer" }, { id, seen: first.seen });
    const { notes } = await listNotes(jk);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ id, date: "2026-11-01", steady: "Pretend steadier answer", createdAt: first.createdAt, others: [] });
    expect(notes[0]!.at).toBeGreaterThan(first.at);
  });

  it("refuses an empty thought or answer", async () => {
    await expect(saveNote(jk, DAY, ME, { ...PRETEND, thought: "  " })).rejects.toThrow();
    await expect(saveNote(jk, DAY, ME, { ...PRETEND, steady: "" })).rejects.toThrow();
    expect(await db.journal.where("kind").equals("note").count()).toBe(0);
  });

  it("delete leaves a sealed version with nothing in it (sync never hard-deletes); it is no longer listed", async () => {
    const id = await saveNote(jk, DAY, ME, PRETEND);
    await deleteNote(jk, ME, id, (await listNotes(jk)).notes[0]!.seen);
    expect((await listNotes(jk)).notes).toEqual([]);
    const rid = `${id}_${ME}`;
    const opened = (await openJson(jk.key, (await db.journal.get(rid))!, journalAad(rid))) as Record<string, unknown>;
    expect(opened).toMatchObject({ deleted: true, thought: "", steady: "", memory: "", skill: "" });
  });

  it("this device's version sealed with another key is counted unreadable on its own and never written over", async () => {
    const id = journalId("note", DAY, "00000000000000aa");
    const rid = `${id}_${ME}`;
    await db.journal.put({ id: rid, kind: "note", date: DAY, fp: other.fp, ...(await sealJson(other.key, { v: 1, ...PRETEND, createdAt: 1, at: 1 }, journalAad(rid))) });
    await saveNote(jk, DAY, ME, PRETEND);
    expect((await listNotes(jk)).unreadable).toBe(1);
    await expect(saveNote(jk, DAY, ME, PRETEND, { id })).rejects.toThrow(CANT_OPEN);
    await expect(deleteNote(jk, ME, id, [])).rejects.toThrow(CANT_OPEN);
    await expect(saveNoteDraft(jk, ME, id, PRETEND, [])).rejects.toThrow(CANT_OPEN);
    expect((await db.journal.get(rid))!.fp).toBe(other.fp);
  });

  it("nothing is written without the confirmed key", async () => {
    await db.syncMeta.delete(JOURNAL_KEY_META);
    await expect(saveNote(jk, DAY, ME, PRETEND)).rejects.toThrow(NOT_CONFIRMED);
    expect(await db.journal.where("kind").equals("note").count()).toBe(0);
  });
});

describe("two devices never overwrite each other's words (review I1)", () => {
  it("both edit the same note without seeing the other's: the newest shows, the other below as another version", async () => {
    const id = await saveNote(jk, DAY, ME, PRETEND);
    const base = (await listNotes(jk)).notes[0]!.seen;
    // The Mac edits; the phone, which hadn't seen that, edits too (later).
    await saveNote(jk, DAY, ME, { ...PRETEND, steady: "Pretend Mac words" }, { id, seen: base });
    await saveNote(jk, DAY, PHONE, { ...PRETEND, steady: "Pretend phone words" }, { id, seen: base });
    const [n] = (await listNotes(jk)).notes;
    expect(n).toMatchObject({ steady: "Pretend phone words" });
    expect(n!.others.map((o) => o.steady)).toEqual(["Pretend Mac words"]);
    // Once she saves with both in front of her, it is one note again.
    await saveNote(jk, DAY, ME, { ...PRETEND, steady: "Pretend both, joined" }, { id, seen: n!.seen });
    expect((await listNotes(jk)).notes).toEqual([expect.objectContaining({ steady: "Pretend both, joined", others: [] })]);
  });

  it("an edit after another's, having seen it, replaces it quietly", async () => {
    const id = await saveNote(jk, DAY, ME, PRETEND);
    await saveNote(jk, DAY, PHONE, { ...PRETEND, steady: "Pretend phone words" }, { id, seen: (await listNotes(jk)).notes[0]!.seen });
    expect((await listNotes(jk)).notes).toEqual([expect.objectContaining({ steady: "Pretend phone words", others: [] })]);
  });

  it("an edit the deleting device never saw keeps the note", async () => {
    const id = await saveNote(jk, DAY, ME, PRETEND);
    const base = (await listNotes(jk)).notes[0]!.seen;
    await saveNote(jk, DAY, PHONE, { ...PRETEND, steady: "Pretend phone words" }, { id, seen: base });
    await deleteNote(jk, ME, id, base); // the Mac deletes what it had (not the phone's edit)
    expect((await listNotes(jk)).notes).toEqual([expect.objectContaining({ id, steady: "Pretend phone words" })]);
  });

  it("a delete made having seen every version removes the note", async () => {
    const id = await saveNote(jk, DAY, ME, PRETEND);
    await saveNote(jk, DAY, PHONE, { ...PRETEND, steady: "Pretend phone words" }, { id, seen: (await listNotes(jk)).notes[0]!.seen });
    await deleteNote(jk, ME, id, (await listNotes(jk)).notes[0]!.seen);
    expect((await listNotes(jk)).notes).toEqual([]);
  });
});

describe("a note in progress is kept as this device's draft (review I2)", () => {
  it("saved sealed, listed only on this device, and emptied by Save", async () => {
    const id = newNoteId(DAY);
    await saveNoteDraft(jk, ME, id, { ...PRETEND, steady: "Pretend half an answer" }, []);
    expect(JSON.stringify(await db.journal.get(`${id}_${ME}_draft`))).not.toContain("Pretend");
    expect((await listNotes(jk, ME)).drafts).toEqual([
      { id, date: DAY, fields: { ...PRETEND, steady: "Pretend half an answer" }, seen: [], at: expect.any(Number) },
    ]);
    expect((await listNotes(jk, PHONE)).drafts).toEqual([]);
    expect((await listNotes(jk, ME)).notes).toEqual([]); // not a note until saved
    await saveNote(jk, DAY, ME, { ...PRETEND, steady: "Pretend whole answer" }, { id });
    expect((await listNotes(jk, ME)).drafts).toEqual([]);
    expect((await listNotes(jk, ME)).notes).toEqual([expect.objectContaining({ id, steady: "Pretend whole answer" })]);
  });

  it("Cancel lets it go", async () => {
    const id = newNoteId(DAY);
    await saveNoteDraft(jk, ME, id, PRETEND, []);
    await clearNoteDraft(jk, ME, id);
    expect((await listNotes(jk, ME)).drafts).toEqual([]);
  });
});

describe("I read this today", () => {
  it("each device ticks on its own row; reads merge across devices by day", async () => {
    const a = await saveNote(jk, DAY, ME, PRETEND);
    const b = await saveNote(jk, DAY, ME, { ...PRETEND, thought: "Pretend second thought" });
    await setNoteRead(jk, "2026-11-02", ME, a, true);
    await setNoteRead(jk, DAY, ME, a, true);
    await setNoteRead(jk, DAY, PHONE, b, true);
    expect(await db.journal.get(`note-read:${DAY}:${ME}`)).toBeTruthy();
    expect(await db.journal.get(`note-read:${DAY}:${PHONE}`)).toBeTruthy();
    const reads = await listNoteReads(jk);
    expect(reads.lastRead.get(a)).toBe(DAY);
    expect(reads.lastRead.get(b)).toBe(DAY);
    expect(reads.readOn(DAY)).toEqual(new Set([a, b]));
    expect(reads.readOn("2026-11-02")).toEqual(new Set([a]));
    // Untick on this device.
    await setNoteRead(jk, DAY, ME, a, false);
    expect((await listNoteReads(jk)).readOn(DAY)).toEqual(new Set([b]));
    // Which notes were read is only inside the sealed entry.
    expect(JSON.stringify(await db.journal.get(`note-read:${DAY}:${PHONE}`))).not.toContain(b.slice(-12));
  });
});

describe("two quick ticks (review M2)", () => {
  it("ticking two notes at once keeps both", async () => {
    const a = await saveNote(jk, DAY, ME, PRETEND);
    const b = await saveNote(jk, DAY, ME, { ...PRETEND, thought: "Pretend second thought" });
    await Promise.all([setNoteRead(jk, DAY, ME, a, true), setNoteRead(jk, DAY, ME, b, true)]);
    expect((await listNoteReads(jk)).ownOn(DAY, ME)).toEqual(new Set([a, b]));
  });
});
