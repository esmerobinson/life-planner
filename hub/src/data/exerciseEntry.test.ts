import { vi } from "vitest";
import { db } from "./db";
import {
  CANT_OPEN, listExerciseEntries, NOT_CONFIRMED, readExerciseEntry, readExerciseProgress, saveExerciseDraft,
  submitExerciseEntry,
} from "./repo";
import { journalId, validJournal } from "./validate";
import { exerciseCardKey, journalAad, openJson, sealJson, toBase64, type JournalKey } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";

// The exercise response (journal polish brief §1–2): her written response to today's card is
// its own sealed per-device row `exercise-entry:<date>:<cardKey>:<deviceId>`, written only
// through the confirmed-key gate. Submit also marks today's card Done; a draft never does.
// Fictional words only.

const DAY = "2026-10-30";
const ME = "device-mac-0001";
const PHONE = "device-phone-01";
const CARD = { day: 3, theme: "Imaginary pebbles" };
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
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear()]);
  await confirmedDevice(db, jk);
});
afterEach(() => vi.restoreAllMocks());

const IV16 = toBase64(new Uint8Array(12));
const FP = "0123456789abcdef";
const row = (o: Record<string, unknown>) => ({ date: DAY, fp: FP, iv: IV16, ct: "AAAAAAAAAAAAAAAAAAAAAA==", ...o });

/** Another device's row, sealed exactly as the repo seals it. */
async function theirRow(key: JournalKey, date: string, device: string, entry: Record<string, unknown>) {
  const id = journalId("exercise-entry", date, `${await exerciseCardKey(key, entry.day as number, entry.theme as string)}:${device}`);
  return { id, kind: "exercise-entry" as const, date, fp: key.fp, ...(await sealJson(key.key, { v: 1, ...entry }, journalAad(id))) };
}

describe("row ids", () => {
  it("exercise-entry:<date>:<12 hex cardKey>:<deviceId> is a valid journal row; nothing else is", async () => {
    const key = await exerciseCardKey(jk, 3, "Imaginary pebbles");
    expect(key).toMatch(/^[0-9a-f]{12}$/);
    expect(await exerciseCardKey(jk, 3, "Imaginary pebbles")).toBe(key);
    expect(await exerciseCardKey(jk, 3, "Another theme")).not.toBe(key);
    expect(await exerciseCardKey(other, 3, "Imaginary pebbles")).not.toBe(key);
    expect(validJournal(row({ id: `exercise-entry:${DAY}:${key}:${ME}`, kind: "exercise-entry" }))).toBe(true);
    expect(validJournal(row({ id: `exercise-entry:${DAY}:${ME}`, kind: "exercise-entry" }))).toBe(false);
    expect(validJournal(row({ id: `exercise-entry:${DAY}:3:${ME}`, kind: "exercise-entry" }))).toBe(false);
    expect(validJournal(row({ id: `exercise-entry:2026-10-29:${key}:${ME}`, kind: "exercise-entry" }))).toBe(false);
  });
});

describe("submit", () => {
  it("seals the response with the confirmed key on this device's own row and marks today's card Done", async () => {
    await submitExerciseEntry(jk, DAY, ME, CARD, "Pretend response words");
    const id = `exercise-entry:${DAY}:${await exerciseCardKey(jk, 3, CARD.theme)}:${ME}`;
    const stored = (await db.journal.get(id))!;
    expect(stored).toMatchObject({ kind: "exercise-entry", date: DAY, fp: jk.fp });
    expect(Object.keys(stored).sort()).toEqual(["ct", "date", "fp", "id", "iv", "kind", "updatedAt"]);
    const clear = JSON.stringify(stored);
    for (const word of ["Pretend", "pebbles", "Imaginary", '"day"']) expect(clear).not.toContain(word);
    expect(await openJson(jk.key, stored, journalAad(id))).toEqual({
      v: 1, day: 3, theme: CARD.theme, text: "Pretend response words", submittedAt: expect.any(Number), at: expect.any(Number),
    });
    expect(await db.pending.get(["journal", id])).toBeTruthy();
    // The existing done mark, on this device's own progress row.
    expect((await readExerciseProgress(jk)).marks).toEqual([{ date: DAY, device: ME, day: 3, done: true }]);
    expect(await readExerciseEntry(jk, DAY, CARD)).toMatchObject({
      entry: { date: DAY, day: 3, theme: CARD.theme, text: "Pretend response words", saved: true, submitted: true },
      unreadable: 0,
    });
  });

  it("submitting again updates this device's row (one row, the new text)", async () => {
    await submitExerciseEntry(jk, DAY, ME, CARD, "Pretend first");
    await submitExerciseEntry(jk, DAY, ME, CARD, "Pretend second");
    expect(await db.journal.where("kind").equals("exercise-entry").count()).toBe(1);
    expect((await readExerciseEntry(jk, DAY, CARD)).entry).toMatchObject({ text: "Pretend second", saved: true });
  });

  it("an unconfirmed key can't write a response, a draft or the done mark", async () => {
    await expect(submitExerciseEntry(other, DAY, ME, CARD, "Pretend")).rejects.toThrow(NOT_CONFIRMED);
    await expect(saveExerciseDraft(other, DAY, ME, CARD, "Pretend")).rejects.toThrow(NOT_CONFIRMED);
    expect(await db.journal.where("kind").anyOf("exercise-entry", "exercise").count()).toBe(0);
  });

  it("nothing to submit: an empty response is refused and writes nothing", async () => {
    await expect(submitExerciseEntry(jk, DAY, ME, CARD, "   ")).rejects.toThrow();
    expect(await db.journal.where("kind").anyOf("exercise-entry", "exercise").count()).toBe(0);
  });
});

describe("draft autosave", () => {
  it("a draft is saved sealed but never marks Done", async () => {
    await saveExerciseDraft(jk, DAY, ME, CARD, "Pretend half a thought");
    expect((await readExerciseProgress(jk)).marks).toEqual([]);
    expect((await readExerciseEntry(jk, DAY, CARD)).entry).toMatchObject({
      text: "Pretend half a thought", saved: false, submitted: false,
    });
  });

  it("an edit after Submit is kept as a draft: still submitted, no longer 'Saved' until Submit again", async () => {
    await submitExerciseEntry(jk, DAY, ME, CARD, "Pretend submitted");
    await saveExerciseDraft(jk, DAY, ME, CARD, "Pretend submitted, then more");
    expect((await readExerciseEntry(jk, DAY, CARD)).entry).toMatchObject({
      text: "Pretend submitted, then more", saved: false, submitted: true,
    });
    await submitExerciseEntry(jk, DAY, ME, CARD, "Pretend submitted, then more");
    expect((await readExerciseEntry(jk, DAY, CARD)).entry).toMatchObject({ saved: true });
  });

  it("this device's row sealed with another key is never written over", async () => {
    const theirs = await theirRow(other, DAY, ME, { day: 3, theme: CARD.theme, text: "x", submittedAt: null, at: 1 });
    // Moved to the id this key uses, so it sits where this device's own row would.
    const mine = `exercise-entry:${DAY}:${await exerciseCardKey(jk, 3, CARD.theme)}:${ME}`;
    await db.journal.put({ ...theirs, id: mine });
    const before = await db.journal.get(mine);
    await expect(saveExerciseDraft(jk, DAY, ME, CARD, "Pretend")).rejects.toThrow(CANT_OPEN);
    expect(await db.journal.get(mine)).toEqual(before);
    expect((await readExerciseEntry(jk, DAY, CARD)).unreadable).toBe(1);
  });
});

describe("two devices", () => {
  it("each device keeps its own row; the newest non-empty response shows", async () => {
    await submitExerciseEntry(jk, DAY, ME, CARD, "Pretend from the Mac");
    await db.journal.put(
      await theirRow(jk, DAY, PHONE, { day: 3, theme: CARD.theme, text: "Pretend from the phone", submittedAt: clock + 5, at: clock + 5 }),
    );
    expect(await db.journal.where("kind").equals("exercise-entry").count()).toBe(2);
    expect((await readExerciseEntry(jk, DAY, CARD)).entry).toMatchObject({ text: "Pretend from the phone", saved: true });
    // A newer but empty row never hides a response.
    await db.journal.put(await theirRow(jk, DAY, PHONE, { day: 3, theme: CARD.theme, text: "  ", submittedAt: null, at: clock + 50 }));
    expect((await readExerciseEntry(jk, DAY, CARD)).entry).toMatchObject({ text: "Pretend from the Mac", saved: true, submitted: true });
  });
});

describe("Past exercises", () => {
  it("newest first, one per day and card, with the theme from the entry; empty drafts and today left out", async () => {
    await submitExerciseEntry(jk, "2026-10-27", ME, { day: 1, theme: "Pretend weather" }, "Pretend one");
    await submitExerciseEntry(jk, "2026-10-29", ME, { day: 2, theme: "The fictional kettle" }, "Pretend two");
    await db.journal.put(
      await theirRow(jk, "2026-10-29", PHONE, { day: 2, theme: "The fictional kettle", text: "Pretend two, phone", submittedAt: 1, at: 1 }),
    );
    await saveExerciseDraft(jk, "2026-10-28", ME, { day: 5, theme: "The made-up garden" }, "Pretend never submitted");
    await saveExerciseDraft(jk, "2026-10-26", ME, { day: 4, theme: "A pretend lighthouse" }, "");
    await submitExerciseEntry(jk, DAY, ME, CARD, "Pretend today");
    await db.journal.put(await theirRow(other, "2026-10-25", PHONE, { day: 1, theme: "Pretend weather", text: "x", submittedAt: 1, at: 1 }));
    const past = await listExerciseEntries(jk, DAY);
    expect(past.entries.map((e) => [e.date, e.day, e.theme, e.text, e.submitted])).toEqual([
      ["2026-10-29", 2, "The fictional kettle", "Pretend two", true],
      ["2026-10-28", 5, "The made-up garden", "Pretend never submitted", false],
      ["2026-10-27", 1, "Pretend weather", "Pretend one", true],
    ]);
    expect(past.unreadable).toBe(1);
  });

  it("two cards on one day are two entries", async () => {
    await submitExerciseEntry(jk, "2026-10-29", ME, { day: 2, theme: "The fictional kettle" }, "Pretend kettle");
    await submitExerciseEntry(jk, "2026-10-29", ME, { day: 3, theme: "Imaginary pebbles" }, "Pretend pebbles");
    const past = await listExerciseEntries(jk, DAY);
    expect(past.entries.map((e) => e.day).sort()).toEqual([2, 3]);
  });
});
