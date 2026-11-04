import { db } from "./db";
import { finishMorningPage, readMorningDay, readPromptSettings, saveMorningDraft, savePromptSettings } from "./repo";
import { journalId } from "./validate";
import { journalAad, sealJson, type JournalKey } from "../journal/crypto";
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
