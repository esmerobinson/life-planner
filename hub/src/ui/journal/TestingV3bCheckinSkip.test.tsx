import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { db } from "../../data/db";
import { ensureCheckinSet, readCheckinDay, saveAnswer } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { DailyCheckIn } from "./DailyCheckIn";

// Testing session (journal-v3 round 2 recheck), Daily check-in on two devices, Skip. Fictional words.
//
// What Esme would see: on the phone (offline, say on the train) she starts the check-in, types
// a first thought into question 1 and leaves it there (autosaved, not moved past). Later, on the
// Mac, she answers question 1 properly (or, once checked in, uses Edit to clear it). Back on the
// phone, still not synced, question 1 shows her first thought; she taps Skip (nothing new typed).
// When the phone syncs, the Mac's newer answer is gone from every device: Past check-ins and Read
// back show the phone's older first thought again (a cleared answer comes back the same way).
// Skip typed nothing, yet it hid newer words.
// Cause: journalRepo.ts moveAnswerOn (~line 410) rewrites this device's own row with the words
// it already held but a NEW `at` (saveAnswer stamps Date.now()), and mergeAnswer (~line 285)
// picks the answer with the larger `at`. Also on the live build (af4f7a2 moveAnswerOn, same
// code): not new in round 2, but round 2's "cleared" marker is undone the same way.

const TODAY = "2026-10-28";
const MAC = "device-mac-test-01";
const PHONE = "device-phone-test-01";
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-v3b-checkin-skip-passphrase");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear()]);
  await confirmedDevice(db, jk);
  await ensureCheckinSet(jk, TODAY, ["M1", "D3"]);
});
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 100));
});

const later = () => new Promise((r) => setTimeout(r, 5));

/** Writes a row as the other device would, then takes it out again (the phone hasn't synced yet). */
async function onTheMacNotYetSynced(write: () => Promise<void>) {
  const before = new Set((await db.journal.toArray()).map((r) => r.id));
  await write();
  const rows = (await db.journal.toArray()).filter((r) => !before.has(r.id));
  await db.journal.bulkDelete(rows.map((r) => r.id));
  return rows;
}

async function phoneSkipsQuestionOne() {
  render(
    <MemoryRouter>
      <DailyCheckIn jk={jk} today={TODAY} deviceId={PHONE} />
    </MemoryRouter>,
  );
  expect(await screen.findByRole("textbox", { name: "Your answer" })).toHaveValue("Pretend first thought on the phone");
  await userEvent.click(screen.getByRole("button", { name: "Skip" }));
  await screen.findByRole("img", { name: "Question 2 of 2" });
  cleanup();
}

it("phone offline: Skip on question 1 (nothing new typed) never hides the Mac's newer answer to it", async () => {
  await saveAnswer(jk, TODAY, "M1", PHONE, "Pretend first thought on the phone", false); // autosaved, not moved past
  await later();
  const macRows = await onTheMacNotYetSynced(() => saveAnswer(jk, TODAY, "M1", MAC, "Pretend proper answer on the Mac", true));
  await later();
  await phoneSkipsQuestionOne();
  await db.journal.bulkPut(macRows); // the phone syncs
  // Fails: "Pretend first thought on the phone" (Skip re-stamped the phone's older words).
  expect((await readCheckinDay(jk, TODAY)).answers.get("M1")?.answer).toBe("Pretend proper answer on the Mac");
}, 15_000);

it("phone offline: Skip on question 1 never brings back an answer she cleared on the Mac with Edit", async () => {
  await saveAnswer(jk, TODAY, "M1", PHONE, "Pretend first thought on the phone", false);
  await later();
  const macRows = await onTheMacNotYetSynced(async () => {
    await saveAnswer(jk, TODAY, "M1", MAC, "Pretend Mac answer", true);
    await saveAnswer(jk, TODAY, "D3", MAC, "Pretend Mac answer two", true);
    await later();
    await saveAnswer(jk, TODAY, "M1", MAC, "", true, { session: "pretend1" }); // Edit: cleared on purpose
  });
  await later();
  await phoneSkipsQuestionOne();
  await db.journal.bulkPut(macRows);
  // Fails: the phone's first thought is the answer again.
  expect((await readCheckinDay(jk, TODAY)).answers.get("M1")?.answer ?? null).toBeNull();
}, 15_000);
