// Testing session (restore-safe ripples): after a Replace the device writes with a NEW device id,
// so the restored rows (under the former id) stay as they were. Where an answer was emptied on
// purpose, the restored row's words now win the merge: what she cleared comes back.
// Repo level, one device, no sync needed (the restored rows alone are enough).
// Fictional words only.

import { db } from "./db";
import { exportBackup, restoreBackup } from "./backup";
import { moveAnswerOn, readCheckinDay, readExerciseEntry, saveAnswer, saveExerciseDraft, submitExerciseEntry } from "./repo";
import type { JournalKey } from "../journal/crypto";
import { getDeviceId } from "../sync/engine";
import { confirmedDevice, keyFor } from "../test/journalKey";

const DAY = "2026-11-05";
const CARD = { id: "pretend-card-1", day: 1, theme: "Pretend theme", legacy: false };
const PROMPT = "Pretend question?";
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-journal-restore-undo");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear(), db.items.clear(), db.goals.clear(), db.files.clear()]);
  await confirmedDevice(db, jk);
});

const backup = async () => JSON.parse(JSON.stringify(await exportBackup(DAY)));
const later = () => new Promise((r) => setTimeout(r, 5));

describe("after a Replace, an answer she empties on purpose stays empty", () => {
  it("check-in: she erases the restored half-typed answer and presses Skip: the question is skipped, the words don't come back", async () => {
    const mac = await getDeviceId(db);
    // Before the backup: she had typed a little into the question, not moved on yet.
    await saveAnswer(jk, DAY, PROMPT, mac, "Pretend half answer", false);
    const file = await backup();
    await restoreBackup(file, "replace");
    await later();
    const now = await getDeviceId(db);
    expect((await readCheckinDay(jk, DAY)).answers.get(PROMPT)!.answer).toBe("Pretend half answer"); // the box opens on it
    // She selects it all, deletes it, and presses Skip (DailyCheckIn: something changed, so saveAnswer(null, done, skip)).
    await saveAnswer(jk, DAY, PROMPT, now, null, true, undefined, true);
    const a = (await readCheckinDay(jk, DAY)).answers.get(PROMPT)!;
    expect(a.answer).toBeNull();
    expect(a.skipped).toBe(true);
  });

  it("check-in: Skip on a restored blank question (typed and deleted before the backup) keeps it out of the finished check-in", async () => {
    const mac = await getDeviceId(db);
    await saveAnswer(jk, DAY, PROMPT, mac, null, false); // the box autosaved empty before the backup
    const file = await backup();
    await restoreBackup(file, "replace");
    await later();
    await moveAnswerOn(jk, DAY, PROMPT, await getDeviceId(db), { skip: true });
    expect((await readCheckinDay(jk, DAY)).answers.get(PROMPT)!.skipped).toBe(true);
  });

  it("exercise (bug #19 after a Replace): she had cleared her submitted answer to rewrite it; after the Replace the box is still empty", async () => {
    const mac = await getDeviceId(db);
    await submitExerciseEntry(jk, DAY, mac, CARD, "Pretend first go at this card");
    await later();
    await saveExerciseDraft(jk, DAY, mac, CARD, ""); // select all, delete (autosaved)
    expect((await readExerciseEntry(jk, DAY, CARD, mac)).entry!.text).toBe(""); // bug #19's fix, before the Replace
    const file = await backup();
    await restoreBackup(file, "replace");
    await later();
    expect((await readExerciseEntry(jk, DAY, CARD, await getDeviceId(db))).entry!.text).toBe("");
  });
});
