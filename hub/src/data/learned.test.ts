import { db } from "./db";
import { listLearned, readLearned, saveLearned } from "./repo";
import { validJournal } from "./validate";
import { journalAad, sealJson } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";

// "What I learned about BPD / mental health today" (optional, under the Mental health exercise):
// sealed in the journal, one row per saved version (bug #41). Made-up words only.

const DAY = "2026-11-03";
const ME = "device-pretend-mac-01";
const PHONE = "device-pretend-phone-1";

beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.syncMeta.clear(), db.pending.clear()]);
});

async function setup() {
  const jk = await keyFor("fake-journal-learned");
  await confirmedDevice(db, jk);
  return jk;
}

it("is saved sealed, as a version in this device's own row, and read back", async () => {
  const jk = await setup();
  const id = await saveLearned(jk, DAY, ME, "Pretend: a feeling is a wave, not a wall.");
  expect(id.startsWith(`learned:${DAY}:${ME}_`)).toBe(true);
  const row = (await db.journal.get(id))!;
  expect(row).toMatchObject({ kind: "learned", date: DAY, fp: jk.fp });
  expect(validJournal(row)).toBe(true);
  expect(JSON.stringify(row)).not.toContain("Pretend");
  expect(await readLearned(jk, DAY)).toMatchObject({ id, device: ME, text: "Pretend: a feeling is a wave, not a wall.", others: [], unreadable: 0 });
});

it("a session rewrites only its own version; a new one replaces only the version it names", async () => {
  const jk = await setup();
  const a = await saveLearned(jk, DAY, ME, "Pretend first");
  const b = await saveLearned(jk, DAY, ME, "Pretend first, then more", { seen: [a] });
  await saveLearned(jk, DAY, ME, "Pretend first, then more and more", { version: b, seen: [a] });
  expect(await readLearned(jk, DAY)).toMatchObject({ id: b, text: "Pretend first, then more and more", others: [] });
  expect(await db.journal.where("kind").equals("learned").count()).toBe(2); // nothing is written over but its own
});

it("another device's words are never replaced unless seen: both stay, the newest shows", async () => {
  const jk = await setup();
  const mine = await saveLearned(jk, DAY, ME, "Pretend Mac words");
  const id = `learned:${DAY}:${PHONE}`; // an earlier one-row-per-device row still reads
  await db.journal.put({ id, kind: "learned", date: DAY, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, text: "Pretend phone words", at: Date.now() + 5 }, journalAad(id))) });
  const day = await readLearned(jk, DAY);
  expect(day).toMatchObject({ id, device: PHONE, text: "Pretend phone words" });
  expect(day.others).toEqual([expect.objectContaining({ id: mine, device: ME, text: "Pretend Mac words" })]);
  // Added to on the Mac, from the phone's words: replaces the phone's version only.
  await saveLearned(jk, DAY, ME, "Pretend phone words, and more", { seen: [id] });
  const after = await readLearned(jk, DAY);
  expect(after.text).toBe("Pretend phone words, and more");
  expect(after.others.map((o) => o.text)).toEqual(["Pretend Mac words"]);
  await expect(saveLearned(jk, DAY, ME, "x", { version: id })).rejects.toThrow(); // never another device's row
});

it("emptied: saved as empty; earlier days are listed, empty ones left out", async () => {
  const jk = await setup();
  await saveLearned(jk, "2026-11-01", ME, "Pretend first day");
  const v = await saveLearned(jk, "2026-11-02", ME, "Pretend typed then cleared");
  await saveLearned(jk, "2026-11-02", ME, "", { version: v });
  await saveLearned(jk, DAY, ME, "Pretend today");
  expect((await readLearned(jk, "2026-11-02")).text).toBe("");
  expect((await listLearned(jk, DAY)).map((d) => [d.date, d.text])).toEqual([["2026-11-01", "Pretend first day"]]);
});

it("a row that won't open is counted, never written over", async () => {
  const jk = await setup();
  const other = await keyFor("fake-journal-learned-other");
  const id = `learned:${DAY}:${ME}_zzz`;
  await db.journal.put({ id, kind: "learned", date: DAY, fp: other.fp, ...(await sealJson(other.key, { v: 1, text: "x", at: 1 }, journalAad(id))) });
  await expect(saveLearned(jk, DAY, ME, "Pretend", { version: id })).rejects.toThrow();
  await saveLearned(jk, DAY, ME, "Pretend saved beside");
  expect(await readLearned(jk, DAY)).toMatchObject({ text: "Pretend saved beside", unreadable: 1 });
});

it("the id must be learned:<date>:<device>[_<version>]", async () => {
  const jk = await setup();
  const sealed = await sealJson(jk.key, { v: 1, text: "x", at: 1 }, journalAad("x"));
  expect(validJournal({ id: `learned:${DAY}:${ME}_abc123`, kind: "learned", date: DAY, fp: jk.fp, ...sealed })).toBe(true);
  expect(validJournal({ id: `learned:${DAY}`, kind: "learned", date: DAY, fp: jk.fp, ...sealed })).toBe(false);
});
