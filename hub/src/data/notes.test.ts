import { vi } from "vitest";
import { db } from "./db";
import {
  CANT_OPEN, deleteNote, listNoteReads, listNotes, NOT_CONFIRMED, saveNote, setNoteRead,
} from "./repo";
import { journalId, validJournal } from "./validate";
import { journalAad, openJson, sealJson, toBase64, type JournalKey } from "../journal/crypto";
import { JOURNAL_KEY_META } from "../journal/keyStore";
import { confirmedDevice, keyFor } from "../test/journalKey";

// Notes to myself (journal v3): each note is its own sealed row `note:<date>:<uuid>`, and each
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
  it("note:<date>:<uuid> and note-read:<date>:<deviceId> are valid journal rows; other shapes are not", () => {
    const uuid = "3f2a1b4c-0000-4000-8000-000000000001";
    expect(validJournal(row({ id: `note:${DAY}:${uuid}`, kind: "note" }))).toBe(true);
    expect(validJournal(row({ id: `note-read:${DAY}:${ME}`, kind: "note-read" }))).toBe(true);
    expect(validJournal(row({ id: `note:${DAY}`, kind: "note" }))).toBe(false);
    expect(validJournal(row({ id: `note:2026-11-03:${uuid}`, kind: "note" }))).toBe(false);
    expect(validJournal(row({ id: `note-read:${DAY}:${ME}`, kind: "note" }))).toBe(false);
    expect(validJournal(row({ id: `note:${DAY}:${uuid}`, kind: "note", text: "plaintext by mistake" }))).toBe(false);
    expect(journalId("note", DAY, uuid)).toBe(`note:${DAY}:${uuid}`);
  });
});

describe("notes", () => {
  it("saves a note sealed (nothing typed in clear) and lists it back", async () => {
    const id = await saveNote(jk, DAY, PRETEND);
    expect(id).toMatch(new RegExp(`^note:${DAY}:[0-9a-f-]{36}$`));
    const stored = await db.journal.get(id);
    expect(stored).toMatchObject({ kind: "note", date: DAY, fp: jk.fp });
    expect(JSON.stringify(stored)).not.toContain("Pretend");
    expect(await db.pending.get(["journal", id])).toBeTruthy(); // it syncs
    const { notes, unreadable } = await listNotes(jk);
    expect(unreadable).toBe(0);
    expect(notes).toEqual([{ id, date: DAY, ...PRETEND, createdAt: expect.any(Number), at: expect.any(Number) }]);
  });

  it("an own thought has no prompt; the optional fields are kept", async () => {
    const id = await saveNote(jk, DAY, { prompt: null, thought: "Pretend own thought", steady: "Pretend own answer", memory: "Pretend memory", skill: "Pretend skill" });
    expect((await listNotes(jk)).notes[0]).toMatchObject({ id, prompt: null, memory: "Pretend memory", skill: "Pretend skill" });
  });

  it("editing rewrites the same row (its day and first-written time kept)", async () => {
    const id = await saveNote(jk, "2026-11-01", PRETEND);
    const first = (await listNotes(jk)).notes[0]!;
    await saveNote(jk, DAY, { ...PRETEND, steady: "Pretend steadier answer" }, id);
    const { notes } = await listNotes(jk);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ id, date: "2026-11-01", steady: "Pretend steadier answer", createdAt: first.createdAt });
    expect(notes[0]!.at).toBeGreaterThan(first.at);
  });

  it("refuses an empty thought or answer", async () => {
    await expect(saveNote(jk, DAY, { ...PRETEND, thought: "  " })).rejects.toThrow();
    await expect(saveNote(jk, DAY, { ...PRETEND, steady: "" })).rejects.toThrow();
    expect(await db.journal.where("kind").equals("note").count()).toBe(0);
  });

  it("delete leaves a sealed row with nothing in it (sync never hard-deletes); it is no longer listed", async () => {
    const id = await saveNote(jk, DAY, PRETEND);
    await deleteNote(jk, id);
    expect((await listNotes(jk)).notes).toEqual([]);
    const opened = (await openJson(jk.key, (await db.journal.get(id))!, journalAad(id))) as Record<string, unknown>;
    expect(opened).toMatchObject({ deleted: true, thought: "", steady: "", memory: "", skill: "" });
  });

  it("a note sealed with another key is counted unreadable on its own and never written over", async () => {
    const id = journalId("note", DAY, "3f2a1b4c-0000-4000-8000-000000000002");
    await db.journal.put({ id, kind: "note", date: DAY, fp: other.fp, ...(await sealJson(other.key, { v: 1, ...PRETEND, createdAt: 1, at: 1 }, journalAad(id))) });
    await saveNote(jk, DAY, PRETEND);
    expect((await listNotes(jk)).unreadable).toBe(1);
    await expect(saveNote(jk, DAY, PRETEND, id)).rejects.toThrow(CANT_OPEN);
    await expect(deleteNote(jk, id)).rejects.toThrow(CANT_OPEN);
  });

  it("nothing is written without the confirmed key", async () => {
    await db.syncMeta.delete(JOURNAL_KEY_META);
    await expect(saveNote(jk, DAY, PRETEND)).rejects.toThrow(NOT_CONFIRMED);
    expect(await db.journal.where("kind").equals("note").count()).toBe(0);
  });
});

describe("I read this today", () => {
  it("each device ticks on its own row; reads merge across devices by day", async () => {
    const a = await saveNote(jk, DAY, PRETEND);
    const b = await saveNote(jk, DAY, { ...PRETEND, thought: "Pretend second thought" });
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
