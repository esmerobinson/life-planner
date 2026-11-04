import { vi } from "vitest";
import { db } from "./db";
import { listExerciseEntries, readExerciseEntry, saveExerciseDraft, submitExerciseEntry, type PartAnswer } from "./repo";
import { journalId } from "./validate";
import { exerciseCardIdKey, exerciseCardKey, journalAad, sealJson, type JournalKey } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";

// Esme, 2026-11-04: "I submitted responses on todays exercise but cant see it in past exercises
// and it is not accurate to what i typed". A submitted response is never overwritten or hidden
// by a draft (this device's, after Submit, or another device's), and nothing she wrote is ever
// dropped from what reads back. Fictional words only.

const DAY = "2026-11-04";
const ME = "device-mac-0001";
const PHONE = "device-phone-01";
const CARD = { id: "pretend-ch1-naming", day: 1, theme: "Pretend naming", legacy: false };
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-journal-one");
});
let clock = 1_800_000_000_000;
beforeEach(async () => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock++);
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear()]);
  await confirmedDevice(db, jk);
});
afterEach(() => vi.restoreAllMocks());

/** Another device's row for CARD, sealed exactly as the repo seals it (its row id ends with `device`). */
async function theirs(date: string, device: string, entry: Record<string, unknown>, card: { id: string; day: number; theme: string; legacy?: boolean } = CARD) {
  const key = card.legacy ? await exerciseCardKey(jk, card.day, card.theme) : await exerciseCardIdKey(jk, card.id);
  const id = journalId("exercise-entry", date, `${key}:${device}`);
  const body = card.legacy ? { v: 1, day: card.day, theme: card.theme, ...entry } : { v: 2, id: card.id, day: card.day, theme: card.theme, ...entry };
  return { id, kind: "exercise-entry" as const, date, fp: jk.fp, ...(await sealJson(jk.key, body, journalAad(id))) };
}

const LONG = "A long pretend answer.\nSecond line of it, with the very last words typed: pretend ending";

describe("a draft never overwrites or hides a submitted response", () => {
  it("an autosave after Submit on this device: the submitted text still reads back, the newer draft shows as an unsent draft", async () => {
    await submitExerciseEntry(jk, DAY, ME, CARD, LONG);
    await saveExerciseDraft(jk, DAY, ME, CARD, "Pretend half-retyped");
    const [e] = (await listExerciseEntries(jk, "2026-11-05")).entries;
    expect(e).toMatchObject({ text: LONG, submitted: true });
    expect(e!.others).toEqual([expect.objectContaining({ text: "Pretend half-retyped", submitted: false })]);
    // The box still opens on what she typed last, not "Saved".
    expect((await readExerciseEntry(jk, DAY, CARD)).entry).toMatchObject({ text: "Pretend half-retyped", saved: false, submitted: true });
  });

  it("an autosave of the same text after Submit leaves it Saved", async () => {
    await saveExerciseDraft(jk, DAY, ME, CARD, LONG);
    await submitExerciseEntry(jk, DAY, ME, CARD, LONG);
    await saveExerciseDraft(jk, DAY, ME, CARD, LONG);
    expect((await readExerciseEntry(jk, DAY, CARD)).entry).toMatchObject({ text: LONG, saved: true });
    const [e] = (await listExerciseEntries(jk, "2026-11-05")).entries;
    expect(e).toMatchObject({ text: LONG, others: [] });
  });

  it("another device's newer partial draft never hides the submitted response", async () => {
    await submitExerciseEntry(jk, DAY, ME, CARD, LONG);
    await db.journal.put(await theirs(DAY, PHONE, { text: "Pretend half", submittedAt: null, at: clock + 1000 }));
    const { entries } = await listExerciseEntries(jk, "2026-11-05");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ text: LONG, submitted: true });
    expect(entries[0]!.others.map((o) => [o.text, o.submitted])).toEqual([["Pretend half", false]]);
  });

  it("a draft alone reads back as itself (not submitted)", async () => {
    await saveExerciseDraft(jk, DAY, ME, CARD, "Pretend only a draft");
    const [e] = (await listExerciseEntries(jk, "2026-11-05")).entries;
    expect(e).toMatchObject({ text: "Pretend only a draft", submitted: false, others: [] });
  });

  it("two submits of the same card on one day: one entry, the latest", async () => {
    await submitExerciseEntry(jk, DAY, ME, CARD, "Pretend first");
    await submitExerciseEntry(jk, DAY, ME, CARD, "Pretend second");
    const { entries } = await listExerciseEntries(jk, "2026-11-05");
    expect(entries.map((e) => [e.text, e.others.length])).toEqual([["Pretend second", 0]]);
  });

  it("an earlier row from before this fix (a draft written over a submit on one row) still reads back", async () => {
    await db.journal.put(await theirs(DAY, ME, { text: "Pretend edited after submit", submittedAt: clock, at: clock + 5 }));
    const [e] = (await listExerciseEntries(jk, "2026-11-05")).entries;
    expect(e).toMatchObject({ text: "Pretend edited after submit", submitted: true });
  });
});

describe("nothing is dropped when the card changes shape (re-imported cards)", () => {
  const OLD: PartAnswer[] = [
    { prompt: "Pretend: what is there?", kind: "text", answer: "Pretend old words" },
    { prompt: "Three pretend things", kind: "list", answer: ["Pretend a", "Pretend b", "Pretend c"] },
  ];
  const NEW: PartAnswer[] = [
    { prompt: "Pretend: does each fit?", kind: "checklist", answer: [["Pretend item", "Yes", ""]] },
    { prompt: "Pretend: what is there?", kind: "text", answer: "Pretend new words" },
  ];

  it("Submit with the new parts keeps the earlier answers to parts the card no longer has", async () => {
    await submitExerciseEntry(jk, DAY, ME, CARD, OLD);
    await submitExerciseEntry(jk, DAY, ME, CARD, NEW);
    const [e] = (await listExerciseEntries(jk, "2026-11-05")).entries;
    expect(e!.parts).toEqual([...NEW, OLD[1]]);
  });

  it("a plain text answer is kept when the card gains parts", async () => {
    await submitExerciseEntry(jk, DAY, ME, CARD, LONG);
    await submitExerciseEntry(jk, DAY, ME, CARD, NEW);
    const [e] = (await listExerciseEntries(jk, "2026-11-05")).entries;
    expect(e).toMatchObject({ text: LONG, parts: NEW });
  });
});

describe("Read back: one entry per card per day, by the card's full id", () => {
  it("an earlier (version 1, day-keyed) row is never folded into an id'd card, even with the same day and theme", async () => {
    const legacyCard = { id: "day-1", day: 1, theme: CARD.theme, legacy: true };
    await db.journal.put(await theirs(DAY, PHONE, { text: "Pretend from the old cards", submittedAt: clock, at: clock }, legacyCard));
    await submitExerciseEntry(jk, DAY, ME, CARD, LONG);
    const { entries } = await listExerciseEntries(jk, "2026-11-05");
    expect(entries.map((e) => [e.id, e.text]).sort()).toEqual([["day-1", "Pretend from the old cards"], [CARD.id, LONG]]);
  });

  it("two books' Day 1 cards on one day are two entries", async () => {
    const other = { id: "dbt-pretend-001", day: 1, theme: "Pretend costs", legacy: false };
    await submitExerciseEntry(jk, DAY, ME, CARD, LONG);
    await submitExerciseEntry(jk, DAY, ME, other, "Pretend other book");
    const { entries } = await listExerciseEntries(jk, "2026-11-05");
    expect(entries.map((e) => [e.id, e.text]).sort()).toEqual([[other.id, "Pretend other book"], [CARD.id, LONG]]);
  });

  it("different days stay different entries", async () => {
    await submitExerciseEntry(jk, "2026-11-03", ME, CARD, "Pretend Tuesday");
    await submitExerciseEntry(jk, DAY, ME, CARD, "Pretend Wednesday");
    const { entries } = await listExerciseEntries(jk, "2026-11-05");
    expect(entries.map((e) => [e.date, e.text])).toEqual([[DAY, "Pretend Wednesday"], ["2026-11-03", "Pretend Tuesday"]]);
  });
});
