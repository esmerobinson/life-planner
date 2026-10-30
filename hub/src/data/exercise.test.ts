import { vi } from "vitest";
import { db } from "./db";
import {
  CARDS_TOO_BIG, importExerciseCards, NOT_CONFIRMED, readExerciseCards, readExerciseProgress, recordExerciseShown,
  saveExerciseMark, setExerciseStar,
} from "./repo";
import { journalId, validJournal } from "./validate";
import { journalAad, sealJson, toBase64, type JournalKey } from "../journal/crypto";
import { checkCardFile, MAX_CARD_FIELD, type CardSet } from "../journal/exercise";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { FAKE_CARD_FILE } from "../test/exerciseCards";

// The exercise cards' storage (exercise brief "Storage"): the whole set is one sealed journal
// row `cards`; progress is one sealed row per device per day; stars one sealed row per device.
// Only the confirmed key writes. Fictional fixture only.

const DAY = "2026-10-30";
const ME = "device-mac-0001";
const PHONE = "device-phone-01";
const SET = checkCardFile(FAKE_CARD_FILE)!;
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
async function sealedRow(key: JournalKey, kind: string, date: string, suffix: string | undefined, entry: unknown) {
  const id = journalId(kind as never, date, suffix);
  return { id, kind: kind as never, date, fp: key.fp, ...(await sealJson(key.key, entry, journalAad(id))) };
}

describe("row ids", () => {
  it("cards, per-device progress and per-device stars rows are valid journal rows", () => {
    expect(journalId("cards", DAY)).toBe("cards");
    expect(journalId("exercise", DAY, ME)).toBe(`exercise:${DAY}:${ME}`);
    expect(journalId("stars", DAY, ME)).toBe(`stars:${ME}`);
    expect(validJournal(row({ id: "cards", kind: "cards" }))).toBe(true);
    expect(validJournal(row({ id: `exercise:${DAY}:${ME}`, kind: "exercise" }))).toBe(true);
    expect(validJournal(row({ id: `stars:${ME}`, kind: "stars" }))).toBe(true);
    expect(validJournal(row({ id: "cards:x", kind: "cards" }))).toBe(false);
    expect(validJournal(row({ id: `exercise:2026-10-29:${ME}`, kind: "exercise" }))).toBe(false);
    expect(validJournal(row({ id: "stars:", kind: "stars" }))).toBe(false);
    expect(validJournal(row({ id: "stars:a b", kind: "stars" }))).toBe(false);
  });
});

describe("cards", () => {
  it("none until imported; the import is one sealed row (no card text in clear), pending for sync", async () => {
    expect(await readExerciseCards(jk)).toEqual({ state: "none" });
    await importExerciseCards(jk, SET, DAY);
    const stored = (await db.journal.get("cards"))!;
    expect(stored).toMatchObject({ kind: "cards", date: DAY, fp: jk.fp });
    expect(Object.keys(stored).sort()).toEqual(["ct", "date", "fp", "id", "iv", "kind", "updatedAt"]);
    for (const c of SET.cards) expect(JSON.stringify(stored)).not.toContain(c.theme);
    expect(JSON.stringify(stored)).not.toContain("Pretend");
    expect(await db.pending.get(["journal", "cards"])).toBeTruthy();
    expect(await readExerciseCards(jk)).toEqual({ state: "ok", set: SET });
    expect(await readExerciseCards(other)).toEqual({ state: "unreadable" });
  });

  it("re-importing replaces the whole set", async () => {
    await importExerciseCards(jk, SET, DAY);
    const two: CardSet = { source: "Another pretend file", cards: SET.cards.slice(0, 2) };
    await importExerciseCards(jk, two, "2026-10-31");
    expect(await readExerciseCards(jk)).toEqual({ state: "ok", set: two });
    expect(await db.journal.where("kind").equals("cards").count()).toBe(1);
  });

  it("only the confirmed key may seal the cards", async () => {
    await expect(importExerciseCards(other, SET, DAY)).rejects.toThrow(NOT_CONFIRMED);
    expect(await db.journal.get("cards")).toBeUndefined();
  });

  it("a set too big for one synced row is refused with a plain message and nothing is stored", async () => {
    const big = "x".repeat(MAX_CARD_FIELD);
    const cards = Array.from({ length: 120 }, (_, i) => ({ ...SET.cards[0]!, day: i + 1, learn: big, try: big, book: big }));
    await expect(importExerciseCards(jk, { source: "", cards }, DAY)).rejects.toThrow(CARDS_TOO_BIG);
    expect(await db.journal.get("cards")).toBeUndefined();
  });

  it("a stored set of an unknown shape counts as unreadable", async () => {
    await db.journal.put(await sealedRow(jk, "cards", DAY, undefined, { v: 1, source: "", cards: [{ day: 1 }], at: 1 }));
    expect(await readExerciseCards(jk)).toEqual({ state: "unreadable" });
  });
});

describe("progress (one row per device per day)", () => {
  it("shown, then ticked, on this device's own row; another device's row is its own", async () => {
    expect(await recordExerciseShown(jk, DAY, ME, 1)).toBe(true);
    expect(await recordExerciseShown(jk, DAY, ME, 2)).toBe(false); // already there: unchanged
    await saveExerciseMark(jk, DAY, ME, 1, true);
    await saveExerciseMark(jk, DAY, PHONE, 1, false);
    const stored = (await db.journal.get(`exercise:${DAY}:${ME}`))!;
    expect(stored).toMatchObject({ kind: "exercise", date: DAY, fp: jk.fp });
    const p = await readExerciseProgress(jk);
    expect(p.marks.sort((a, b) => a.device.localeCompare(b.device))).toEqual([
      { date: DAY, device: ME, day: 1, done: true },
      { date: DAY, device: PHONE, day: 1, done: false },
    ]);
    expect(p.unreadable).toBe(0);
  });

  it("only the confirmed key writes progress or stars", async () => {
    await expect(saveExerciseMark(other, DAY, ME, 1, true)).rejects.toThrow(NOT_CONFIRMED);
    await expect(recordExerciseShown(other, DAY, ME, 1)).rejects.toThrow(NOT_CONFIRMED);
    await expect(setExerciseStar(other, DAY, ME, 1, true)).rejects.toThrow(NOT_CONFIRMED);
    expect(await db.journal.where("kind").anyOf("exercise", "stars").count()).toBe(0);
  });

  it("a row this key can't open is counted and skipped", async () => {
    await db.journal.put(await sealedRow(other, "exercise", DAY, PHONE, { v: 1, day: 1, done: true, at: 1 }));
    await saveExerciseMark(jk, DAY, ME, 2, true);
    const p = await readExerciseProgress(jk);
    expect(p.marks).toEqual([{ date: DAY, device: ME, day: 2, done: true }]);
    expect(p.unreadable).toBe(1);
  });
});

describe("stars (one row per device; newest mark per card wins)", () => {
  it("star and un-star on this device; another device's newer mark wins", async () => {
    await setExerciseStar(jk, DAY, ME, 2, true);
    await setExerciseStar(jk, DAY, ME, 4, true);
    expect((await readExerciseProgress(jk)).starred).toEqual(new Set([2, 4]));
    await setExerciseStar(jk, DAY, ME, 4, false);
    expect((await readExerciseProgress(jk)).starred).toEqual(new Set([2]));
    expect(await db.journal.where("kind").equals("stars").count()).toBe(1);
    const later = Date.now() + 1000;
    await db.journal.put(await sealedRow(jk, "stars", DAY, PHONE, { v: 1, marks: [{ day: 2, on: false, at: later }, { day: 5, on: true, at: 1 }] }));
    expect((await readExerciseProgress(jk)).starred).toEqual(new Set([5]));
    expect(JSON.stringify(await db.journal.get(`stars:${ME}`))).not.toContain('"day"');
  });

  it("this device's stars row sealed with another key is never written over", async () => {
    const theirs = await sealedRow(other, "stars", DAY, ME, { v: 1, marks: [{ day: 1, on: true, at: 1 }] });
    await db.journal.put(theirs);
    const before = await db.journal.get(`stars:${ME}`);
    await expect(setExerciseStar(jk, DAY, ME, 2, true)).rejects.toThrow();
    expect(await db.journal.get(`stars:${ME}`)).toEqual(before);
    expect(before).toMatchObject(theirs);
    expect((await readExerciseProgress(jk)).unreadable).toBe(1);
  });
});
