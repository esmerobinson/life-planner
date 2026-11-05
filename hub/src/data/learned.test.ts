import { db } from "./db";
import { listLearned, readLearned, saveLearned } from "./repo";
import { validJournal } from "./validate";
import { journalAad, sealJson } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";

// "What I learned about BPD / mental health today" (optional, under the Mental health exercise):
// sealed in the journal, one row per device. Made-up words only.

const DAY = "2026-11-03";
const ME = "device-pretend-mac-01";
const PHONE = "device-pretend-phone-1";

beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.syncMeta.clear(), db.pending.clear()]);
});

it("is saved sealed, in this device's own row, and read back", async () => {
  const jk = await keyFor("fake-journal-learned");
  await confirmedDevice(db, jk);
  await saveLearned(jk, DAY, ME, "Pretend: a feeling is a wave, not a wall.");
  const row = (await db.journal.get(`learned:${DAY}:${ME}`))!;
  expect(row).toMatchObject({ kind: "learned", date: DAY, fp: jk.fp });
  expect(validJournal(row)).toBe(true);
  expect(JSON.stringify(row)).not.toContain("Pretend");
  expect(await readLearned(jk, DAY)).toMatchObject({ text: "Pretend: a feeling is a wave, not a wall.", others: [], unreadable: 0 });
});

it("another device's different words are kept and shown too (the newest first)", async () => {
  const jk = await keyFor("fake-journal-learned");
  await confirmedDevice(db, jk);
  await saveLearned(jk, DAY, ME, "Pretend Mac words");
  const id = `learned:${DAY}:${PHONE}`;
  await db.journal.put({ id, kind: "learned", date: DAY, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, text: "Pretend phone words", at: 1 }, journalAad(id))) });
  const day = await readLearned(jk, DAY);
  expect(day.text).toBe("Pretend Mac words");
  expect(day.others.map((o) => o.text)).toEqual(["Pretend phone words"]);
});

it("emptied: saved as empty (the box can be cleared); earlier days are listed, empty ones left out", async () => {
  const jk = await keyFor("fake-journal-learned");
  await confirmedDevice(db, jk);
  await saveLearned(jk, "2026-11-01", ME, "Pretend first day");
  await saveLearned(jk, "2026-11-02", ME, "Pretend typed then cleared");
  await saveLearned(jk, "2026-11-02", ME, "");
  await saveLearned(jk, DAY, ME, "Pretend today");
  expect((await readLearned(jk, "2026-11-02")).text).toBe("");
  expect((await listLearned(jk, DAY)).map((d) => [d.date, d.text])).toEqual([["2026-11-01", "Pretend first day"]]);
});

it("a row here that won't open is never written over: the words go beside it", async () => {
  const jk = await keyFor("fake-journal-learned");
  const other = await keyFor("fake-journal-learned-other");
  await confirmedDevice(db, jk);
  const id = `learned:${DAY}:${ME}`;
  await db.journal.put({ id, kind: "learned", date: DAY, fp: other.fp, ...(await sealJson(other.key, { v: 1, text: "x", at: 1 }, journalAad(id))) });
  await saveLearned(jk, DAY, ME, "Pretend saved beside");
  expect((await db.journal.get(id))!.fp).toBe(other.fp);
  expect(await readLearned(jk, DAY)).toMatchObject({ text: "Pretend saved beside", unreadable: 1 });
});

it("the id must be learned:<date>:<device>", async () => {
  const jk = await keyFor("fake-journal-learned");
  const sealed = await sealJson(jk.key, { v: 1, text: "x", at: 1 }, journalAad("x"));
  expect(validJournal({ id: `learned:${DAY}:${ME}`, kind: "learned", date: DAY, fp: jk.fp, ...sealed })).toBe(true);
  expect(validJournal({ id: `learned:${DAY}`, kind: "learned", date: DAY, fp: jk.fp, ...sealed })).toBe(false);
});
