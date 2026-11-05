import { db } from "./db";
import { finishMorningPage, moveAnswerOn, readCheckinDay, readMorningDay, readPromptSettings, saveAnswer, saveMorningDraft, savePromptSettings } from "./repo";
import { journalId } from "./validate";
import { journalAad, promptKey, sealJson, type JournalKey } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";

// Testing session, bug (low): two journal rows whose ids don't depend on the key are written
// over when this device can't open them, against journalRepo's rule "a row this key can't open
// is never written over" (the exercise rows already refuse with CANT_OPEN).
//
// What Esme would see: nothing at first ("Can't open this entry on this device" and an empty
// box). But words in that row (this device's morning-pages draft, or her Choose questions
// list) are destroyed by the next autosave / I'm done / tick, so they could never be opened
// again with the key that sealed them. Only happens with a row sealed by another key (a
// passphrase change, a restored backup from another journal) or a damaged row.
// Fictional words only.

const DAY = "2026-10-28";
const ME = "device-mac-0001";
let jk: JournalKey;
let other: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-unreadable-overwrite-one");
  other = await keyFor("fake-unreadable-overwrite-two");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear()]);
  await confirmedDevice(db, jk);
});

async function sealedWith(key: JournalKey, id: string, kind: "draft" | "settings", entry: unknown) {
  return { id, kind, date: DAY, fp: key.fp, ...(await sealJson(key.key, entry, journalAad(id))) };
}

it("this device's morning draft sealed with another key is never written over (autosave or I'm done)", async () => {
  const id = journalId("draft", DAY, ME);
  await db.journal.put(await sealedWith(other, id, "draft", { v: 1, text: "Pretend words under the old key" }));
  const before = await db.journal.get(id);
  expect((await readMorningDay(jk, DAY, ME)).unreadable).toBe(1);
  await saveMorningDraft(jk, DAY, ME, "Pretend new words").catch(() => undefined);
  expect(await db.journal.get(id)).toEqual(before);
  await finishMorningPage(jk, DAY, ME, "Pretend new words").catch(() => undefined);
  expect(await db.journal.get(id)).toEqual(before);
});

it("a Choose questions row sealed with another key is never written over", async () => {
  await db.journal.put(await sealedWith(other, "settings", "settings", { v: 1, active: ["M1", "K2"] }));
  const before = await db.journal.get("settings");
  expect(await readPromptSettings(jk)).toBeNull();
  await savePromptSettings(jk, ["D3"], DAY).catch(() => undefined);
  expect(await db.journal.get("settings")).toEqual(before);
});

// Fix round 2 (re-review m4): the same for check-in typing. Her answer row on this device
// that this key can't open is never written over by autosave, Next, Skip or Edit; what she
// types now is kept beside it, so she can still answer and move on.
it("this device's check-in answer row that won't open is never written over (autosave, Next, Skip, Edit)", async () => {
  const id = journalId("answer", DAY, `${await promptKey(jk, "M1")}:${ME}`);
  await db.journal.put({ id, kind: "answer", date: DAY, fp: jk.fp, iv: "AAAAAAAAAAAAAAAA", ct: "AAAAAAAAAAAAAAAAAAAAAA==" }); // damaged
  const before = await db.journal.get(id);
  await saveAnswer(jk, DAY, "M1", ME, "Pretend typed words", false); // autosave
  expect(await db.journal.get(id)).toEqual(before);
  expect((await readCheckinDay(jk, DAY)).answers.get("M1")).toMatchObject({ answer: "Pretend typed words", done: false });
  await moveAnswerOn(jk, DAY, "M1", ME); // Next / Skip with nothing new typed
  expect(await db.journal.get(id)).toEqual(before);
  expect((await readCheckinDay(jk, DAY)).answers.get("M1")).toMatchObject({ answer: "Pretend typed words", done: true });
  await saveAnswer(jk, DAY, "M1", ME, "Pretend edited words", true); // Next with words, or Edit
  expect(await db.journal.get(id)).toEqual(before);
  expect((await readCheckinDay(jk, DAY)).answers.get("M1")).toMatchObject({ answer: "Pretend edited words", done: true });
});
