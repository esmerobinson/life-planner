import { db } from "../data/db";
import { ensureCheckinSet, finishMorningPage, saveAnswer, saveExerciseMark, saveMorningDraft } from "../data/repo";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { forgetJournalFacts, journalOpenCount, readJournalFacts } from "./journalFacts";

// The farm's journal facts (review I2): read with the confirmed key, only small facts kept, and
// each row opened once per version, so syncs and draft autosaves never re-open the journal.
// Fictional entries.

const ME = "device-farm-test";
const D1 = "2026-11-02";
const D2 = "2026-11-03";

beforeEach(async () => {
  await db.journal.clear();
  await db.syncMeta.clear();
  forgetJournalFacts();
});

async function world() {
  const jk = await keyFor("pretend passphrase for the farm");
  await confirmedDevice(db, jk);
  await finishMorningPage(jk, D1, ME, "Pretend words, a short page.");
  await ensureCheckinSet(jk, D2, ["q1", "q2"]);
  await saveAnswer(jk, D2, "q1", ME, "Pretend answer", true);
  await saveAnswer(jk, D2, "q2", ME, null, true);
  await saveExerciseMark(jk, D2, ME, "day-1", true);
  return jk;
}

it("derives mornings, short pages, check-ins and exercise days", async () => {
  const jk = await world();
  const f = await readJournalFacts(jk);
  expect([...f.morning]).toEqual([D1]);
  expect([...f.shortPages]).toEqual([D1]);
  expect([...f.checkins]).toEqual([D2]);
  expect(f.exercise).toEqual([{ date: D2, card: "day-1" }]);
});

it("opens each row once: a second read, a sync's bookkeeping and a draft save open nothing again", async () => {
  const jk = await world();
  await readJournalFacts(jk);
  const after = journalOpenCount();
  await readJournalFacts(jk);
  expect(journalOpenCount()).toBe(after);
  await db.syncMeta.put({ key: "cursor", value: 42 }); // what a sync run writes
  await saveMorningDraft(jk, D2, ME, "Pretend draft being typed");
  await readJournalFacts(jk);
  expect(journalOpenCount()).toBe(after); // drafts are never opened by the farm
  // A new answer is a new row: only that one is opened.
  await saveAnswer(jk, "2026-11-04", "q1", ME, "Pretend", true);
  await readJournalFacts(jk);
  expect(journalOpenCount()).toBe(after + 1);
});

it("a check-in with a question not yet moved past isn't a check-in day", async () => {
  const jk = await keyFor("pretend passphrase for the farm");
  await confirmedDevice(db, jk);
  await ensureCheckinSet(jk, D1, ["q1", "q2"]);
  await saveAnswer(jk, D1, "q1", ME, "Pretend", true);
  expect([...(await readJournalFacts(jk)).checkins]).toEqual([]);
});
