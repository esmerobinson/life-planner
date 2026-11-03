import { vi } from "vitest";
import { db } from "./db";
import {
  answerFilled, CANT_OPEN, cardRef, listExerciseEntries, logExerciseEntry, readLatestExerciseEntry, responseComplete, responseLoggable, trackerNewInput,
  type PartAnswer, NOT_CONFIRMED, readExerciseEntry, readExerciseProgress, recordExerciseShown,
  saveExerciseDraft, submitExerciseEntry,
} from "./repo";
import { journalId, validJournal } from "./validate";
import { exerciseCardIdKey, exerciseCardKey, journalAad, openJson, sealJson, toBase64, type JournalKey } from "../journal/crypto";
import { parseCardFile } from "../journal/exercise";
import { FAKE_CARD_FILE_CHECKLIST, FAKE_CARD_FILE_KINDS, FAKE_CARD_TEXT_V2 } from "../test/exerciseCards";
import { confirmedDevice, keyFor } from "../test/journalKey";

// The exercise response (journal polish brief §1–2): her written response to today's card is
// its own sealed per-device row `exercise-entry:<date>:<cardKey>:<deviceId>`, written only
// through the confirmed-key gate. Submit also marks today's card Done; a draft never does.
// Fictional words only.

const DAY = "2026-10-30";
const ME = "device-mac-0001";
const PHONE = "device-phone-01";
const legacy = (day: number, theme: string) => ({ id: `day-${day}`, day, theme, legacy: true });
const CARD = legacy(3, "Imaginary pebbles");
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
    expect((await readExerciseProgress(jk)).marks).toEqual([{ date: DAY, device: ME, id: "day-3", done: true, primary: true }]);
    expect(await readExerciseEntry(jk, DAY, CARD)).toMatchObject({
      entry: { date: DAY, id: "day-3", day: 3, theme: CARD.theme, text: "Pretend response words", saved: true, submitted: true },
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
    await submitExerciseEntry(jk, "2026-10-27", ME, legacy(1, "Pretend weather"), "Pretend one");
    await submitExerciseEntry(jk, "2026-10-29", ME, legacy(2, "The fictional kettle"), "Pretend two");
    await db.journal.put(
      await theirRow(jk, "2026-10-29", PHONE, { day: 2, theme: "The fictional kettle", text: "Pretend two, phone", submittedAt: 1, at: 1 }),
    );
    await saveExerciseDraft(jk, "2026-10-28", ME, legacy(5, "The made-up garden"), "Pretend never submitted");
    await saveExerciseDraft(jk, "2026-10-26", ME, legacy(4, "A pretend lighthouse"), "");
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
    await submitExerciseEntry(jk, "2026-10-29", ME, legacy(2, "The fictional kettle"), "Pretend kettle");
    await submitExerciseEntry(jk, "2026-10-29", ME, legacy(3, "Imaginary pebbles"), "Pretend pebbles");
    const past = await listExerciseEntries(jk, DAY);
    expect(past.entries.map((e) => e.day).sort()).toEqual([2, 3]);
  });
});

describe("version 2 cards (Journal v2): by card id", () => {
  const V2 = parseCardFile(FAKE_CARD_TEXT_V2)!.cards;
  const weather = cardRef(V2[1]!);
  const kettle = cardRef(V2[2]!);

  it("a response is keyed by the card's id (opaque), stored with the id, and found again after its theme changes", async () => {
    await submitExerciseEntry(jk, DAY, ME, weather, "Pretend about clouds");
    const id = `exercise-entry:${DAY}:${await exerciseCardIdKey(jk, weather.id)}:${ME}`;
    const stored = (await db.journal.get(id))!;
    expect(JSON.stringify(stored)).not.toContain("pretend-ch1");
    expect(await openJson(jk.key, stored, journalAad(id))).toMatchObject({ v: 2, id: weather.id, day: 1, theme: "Pretend weather" });
    const renamed = { ...weather, theme: "Pretend weather, renamed" };
    expect((await readExerciseEntry(jk, DAY, renamed)).entry).toMatchObject({ id: weather.id, text: "Pretend about clouds", saved: true });
    expect((await readExerciseProgress(jk)).marks).toEqual([{ date: DAY, device: ME, id: weather.id, done: true, primary: true }]);
  });

  it("Do the next one: submitting another card marks it done too, today, and today's card stays today's", async () => {
    await recordExerciseShown(jk, DAY, ME, weather.id);
    await submitExerciseEntry(jk, DAY, ME, kettle, "Pretend kettle words", weather.id);
    expect((await readExerciseProgress(jk)).marks).toEqual([
      { date: DAY, device: ME, id: weather.id, done: false, primary: true },
      { date: DAY, device: ME, id: kettle.id, done: true, primary: false },
    ]);
    await submitExerciseEntry(jk, DAY, ME, weather, "Pretend clouds after all", weather.id);
    expect((await readExerciseProgress(jk)).marks).toEqual([
      { date: DAY, device: ME, id: weather.id, done: true, primary: true },
      { date: DAY, device: ME, id: kettle.id, done: true, primary: false },
    ]);
    expect(await db.journal.where("kind").equals("exercise").count()).toBe(1);
  });

  it("two submits at once (today's card and a next one) both keep their done marks (review M5)", async () => {
    await recordExerciseShown(jk, DAY, ME, weather.id);
    await Promise.all([
      submitExerciseEntry(jk, DAY, ME, weather, "Pretend one", weather.id),
      submitExerciseEntry(jk, DAY, ME, kettle, "Pretend two", weather.id),
    ]);
    const marks = (await readExerciseProgress(jk)).marks.filter((m) => m.done).map((m) => m.id).sort();
    expect(marks).toEqual([kettle.id, weather.id].sort());
  });

  it("Past exercises carry the card id", async () => {
    await submitExerciseEntry(jk, "2026-10-29", ME, weather, "Pretend yesterday");
    expect((await listExerciseEntries(jk, DAY)).entries.map((e) => [e.id, e.day, e.theme])).toEqual([[weather.id, 1, "Pretend weather"]]);
  });
});

describe("a tracker card, a day at a time", () => {
  const KINDS = parseCardFile(JSON.stringify(FAKE_CARD_FILE_KINDS))!.cards;
  const tracker = cardRef(KINDS[2]!);
  const log = (days: string[][]): PartAnswer[] => [{ prompt: "Pretend sleep log", kind: "tracker", answer: days }];

  it("saving a day logs the card for the day (it counts) without marking it done; complete, it is submitted", async () => {
    expect(responseLoggable(log([["", ""], ["", ""], ["", ""]]))).toBe(false);
    expect(responseLoggable(log([["7", "ok"], ["", ""], ["", ""]]))).toBe(true);
    await logExerciseEntry(jk, "2026-10-29", ME, tracker, log([["7", "ok"], ["", ""], ["", ""]]));
    expect((await readExerciseProgress(jk)).marks).toEqual([
      { date: "2026-10-29", device: ME, id: tracker.id, done: false, primary: true },
      { date: "2026-10-29", device: ME, id: tracker.id, done: false, primary: false, logged: true },
    ]);
    // The next day starts from what was saved.
    expect((await readLatestExerciseEntry(jk, DAY, tracker))!.parts![0]!.answer).toEqual([["7", "ok"], ["", ""], ["", ""]]);
    await expect(submitExerciseEntry(jk, DAY, ME, tracker, log([["7", "ok"], ["8", ""], ["", ""]]))).rejects.toThrow();
    await submitExerciseEntry(jk, DAY, ME, tracker, log([["7", "ok"], ["8", "good"], ["6", "fine"]]));
    expect((await readExerciseProgress(jk)).marks.filter((m) => m.date === DAY)).toEqual([
      { date: DAY, device: ME, id: tracker.id, done: true, primary: true },
    ]);
  });

  it("the next day, saving needs something new in the tracker: the days carried forward alone don't log (review I2)", async () => {
    await logExerciseEntry(jk, "2026-10-29", ME, tracker, log([["7", "ok"], ["", ""], ["", ""]]));
    const carried = (await readLatestExerciseEntry(jk, DAY, tracker))!.parts!;
    expect(trackerNewInput(carried, carried)).toBe(false);
    await expect(logExerciseEntry(jk, DAY, ME, tracker, carried)).rejects.toThrow();
    expect((await readExerciseProgress(jk)).marks.some((m) => m.date === DAY)).toBe(false); // no tick today
    const more = log([["7", "ok"], ["8", ""], ["", ""]]);
    expect(trackerNewInput(more, carried)).toBe(true);
    await logExerciseEntry(jk, DAY, ME, tracker, more);
    expect((await readExerciseProgress(jk)).marks.find((m) => m.date === DAY && m.logged)).toMatchObject({ id: tracker.id });
  });

  it("a tracker done in an earlier round isn't carried into the next one (review M6)", async () => {
    await submitExerciseEntry(jk, "2026-10-20", ME, tracker, log([["7", "ok"], ["8", "good"], ["6", "fine"]]));
    expect(await readLatestExerciseEntry(jk, DAY, tracker)).toBeNull();
    await logExerciseEntry(jk, "2026-10-29", ME, tracker, log([["5", "meh"], ["", ""], ["", ""]]));
    expect((await readLatestExerciseEntry(jk, DAY, tracker))!.parts![0]!.answer).toEqual([["5", "meh"], ["", ""], ["", ""]]);
  });

  it("table, scale and chain answers are sealed in the same rows and read back", async () => {
    const [table, scale, , chain] = KINDS.map(cardRef);
    await submitExerciseEntry(jk, DAY, ME, table!, [{ prompt: "Pretend feelings and what set them off", kind: "table", answer: [["a", "b"], ["c", "d"]] }]);
    await submitExerciseEntry(jk, DAY, ME, scale!, [{ prompt: "How pretend-calm are you?", kind: "scale", answer: 4 }], table!.id);
    await submitExerciseEntry(jk, DAY, ME, chain!, [{ prompt: "A pretend chain of events", kind: "chain", answer: ["x", "y", "z"] }], table!.id);
    expect((await readExerciseEntry(jk, DAY, table!)).entry!.parts![0]!.answer).toEqual([["a", "b"], ["c", "d"]]);
    expect((await readExerciseEntry(jk, DAY, scale!)).entry!.parts![0]!.answer).toBe(4);
    expect((await readExerciseEntry(jk, DAY, chain!)).entry!.parts![0]!.answer).toEqual(["x", "y", "z"]);
    await expect(
      submitExerciseEntry(jk, DAY, ME, chain!, [{ prompt: "A pretend chain of events", kind: "chain", answer: ["x", "", "z"] }]),
    ).rejects.toThrow();
  });
});

describe("a checklist part: an [item, choice, note] row per item, sealed like the others", () => {
  const card = cardRef(parseCardFile(JSON.stringify(FAKE_CARD_FILE_CHECKLIST))!.cards[0]!);
  const prompt = parseCardFile(JSON.stringify(FAKE_CARD_FILE_CHECKLIST))!.cards[0]!.parts[0]!.prompt;
  const answer = (rows: string[][]): PartAnswer[] => [{ prompt, kind: "checklist", answer: rows }];
  const rows = (...choices: string[]) => choices.map((c, i) => [`Pretend feature ${i + 1}`, c, i === 0 ? "Pretend note" : ""]);

  it("a draft keeps a partly answered list; Submit needs every item's choice (a note alone is not an answer)", async () => {
    await saveExerciseDraft(jk, DAY, ME, card, answer(rows("Yes", "", "", "")));
    expect((await readExerciseEntry(jk, DAY, card)).entry!.parts).toEqual(answer(rows("Yes", "", "", "")));
    expect((await readExerciseProgress(jk)).marks).toEqual([]);
    expect(answerFilled(answer(rows("Yes", "Partly", "No", ""))[0]!)).toBe(false);
    expect(answerFilled(answer([["One", "", "note only"], ["Two", "Yes", ""]])[0]!)).toBe(false);
    expect(answerFilled(answer([])[0]!)).toBe(false);
    await expect(submitExerciseEntry(jk, DAY, ME, card, answer(rows("Yes", "Partly", "No", "")))).rejects.toThrow();
    await submitExerciseEntry(jk, DAY, ME, card, answer(rows("Yes", "Partly", "No", "Yes")));
    expect((await readExerciseEntry(jk, DAY, card)).entry).toMatchObject({ saved: true, submitted: true, parts: answer(rows("Yes", "Partly", "No", "Yes")) });
  });

  it("a draft of only item words (pills tapped, then cleared) is not content: it is left out of the lists and never hides another device's answer", async () => {
    const empty = answer(rows("", "", "", "").map((r) => [r[0]!, "", ""]));
    // On its own: left out of the lists.
    await saveExerciseDraft(jk, "2026-10-28", PHONE, card, empty);
    expect((await listExerciseEntries(jk, DAY)).entries).toEqual([]);
    // Next to a submitted answer from another device, even a newer one: the answer is what is read.
    await submitExerciseEntry(jk, DAY, ME, card, answer(rows("Yes", "Partly", "No", "Yes")));
    await saveExerciseDraft(jk, DAY, PHONE, card, empty);
    const read = (await readExerciseEntry(jk, DAY, card)).entry!;
    expect(read.parts).toEqual(answer(rows("Yes", "Partly", "No", "Yes")));
    expect(read.submitted).toBe(true);
    const listed = (await listExerciseEntries(jk, "2026-10-31")).entries; // `before` is exclusive
    expect(listed.map((e) => e.date)).toEqual([DAY]); // and not the empty 2026-10-28 draft
    expect(listed[0]!.parts).toEqual(answer(rows("Yes", "Partly", "No", "Yes")));
    // A note alone is something she wrote: it counts.
    await saveExerciseDraft(jk, "2026-10-27", PHONE, card, answer([["Pretend feature one", "", "Pretend only a note"], ["Pretend feature two", "", ""]]));
    expect((await listExerciseEntries(jk, "2026-10-31")).entries.map((e) => e.date)).toEqual([DAY, "2026-10-27"]);
  });

  it("sealed: no word of it in clear", async () => {
    await saveExerciseDraft(jk, DAY, ME, card, answer(rows("Yes", "", "", "")));
    expect(JSON.stringify(await db.journal.toArray())).not.toContain("Pretend note");
  });
});

describe("a card with parts: one answer per part, in the same sealed per-device row", () => {
  const V2 = parseCardFile(FAKE_CARD_TEXT_V2)!.cards;
  const kettle = cardRef(V2[2]!);
  const answers = (list: string[], rating: number | null, choice: string | null): PartAnswer[] => [
    { prompt: "What does your pretend whistle sound like?", kind: "text", answer: "Pretend high whistle" },
    { prompt: "Three pretend places you feel it", kind: "list", answer: list },
    { prompt: "How loud is it right now?", kind: "rating", answer: rating },
    { prompt: "Which pretend kettle is it?", kind: "choice", answer: choice },
  ];

  it("a draft keeps the parts (partly filled) and never marks done; it reads back", async () => {
    await saveExerciseDraft(jk, DAY, ME, kettle, answers(["Pretend chest", "", ""], null, null));
    const id = `exercise-entry:${DAY}:${await exerciseCardIdKey(jk, kettle.id)}:${ME}`;
    const stored = (await db.journal.get(id))!;
    expect(JSON.stringify(stored)).not.toContain("Pretend chest");
    expect(await openJson(jk.key, stored, journalAad(id))).toMatchObject({ v: 2, text: "", parts: answers(["Pretend chest", "", ""], null, null) });
    expect((await readExerciseEntry(jk, DAY, kettle)).entry).toMatchObject({ parts: answers(["Pretend chest", "", ""], null, null), saved: false });
    expect((await readExerciseProgress(jk)).marks).toEqual([]);
  });

  it("Submit needs every part filled (every line of a list); then it marks the card done", async () => {
    await expect(submitExerciseEntry(jk, DAY, ME, kettle, answers(["a", "b", ""], 4, "Tin"))).rejects.toThrow();
    await expect(submitExerciseEntry(jk, DAY, ME, kettle, answers(["a", "b", "c"], null, "Tin"))).rejects.toThrow();
    await expect(submitExerciseEntry(jk, DAY, ME, kettle, answers(["a", "b", "c"], 4, null))).rejects.toThrow();
    expect(await db.journal.where("kind").anyOf("exercise-entry", "exercise").count()).toBe(0);
    await submitExerciseEntry(jk, DAY, ME, kettle, answers(["a", "b", "c"], 0, "Tin"));
    expect((await readExerciseEntry(jk, DAY, kettle)).entry).toMatchObject({ saved: true, submitted: true });
    expect((await readExerciseProgress(jk)).marks).toEqual([{ date: DAY, device: ME, id: kettle.id, done: true, primary: true }]);
  });

  it("responseComplete and answerFilled", () => {
    expect(responseComplete("  ")).toBe(false);
    expect(responseComplete("Pretend")).toBe(true);
    expect(responseComplete([])).toBe(false);
    expect(responseComplete(answers(["a", "b", "c"], 10, "Glass"))).toBe(true);
    expect(answerFilled({ prompt: "p", kind: "list", answer: ["a", " "] })).toBe(false);
  });

  it("listed for reading back (a partly filled draft too); an untouched one is left out", async () => {
    await saveExerciseDraft(jk, "2026-10-28", ME, kettle, answers(["", "", ""], null, null).map((a) => (a.kind === "text" ? { ...a, answer: "" } : a)));
    await saveExerciseDraft(jk, "2026-10-29", ME, kettle, answers(["Pretend", "", ""], null, null));
    const past = await listExerciseEntries(jk, DAY);
    expect(past.entries.map((e) => e.date)).toEqual(["2026-10-29"]);
    expect(past.entries[0]!.parts![1]).toEqual({ prompt: "Three pretend places you feel it", kind: "list", answer: ["Pretend", "", ""] });
  });
});
