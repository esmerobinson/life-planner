import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import { importExerciseCards, listExerciseEntries, submitExerciseEntry } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { checkCardFile } from "../../journal/exercise";
import { getDeviceId } from "../../sync/engine";
import { FAKE_CARD_FILE } from "../../test/exerciseCards";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";

// Testing session (journal-v3), the exercise "Edit" on today's submitted answer (review I4).
// Fictional cards and words only.
//
// Bug C — What Esme would see: in Past exercises she taps Edit on today's answer, starts
// changing it, then thinks better of it and taps Cancel. Her answer reads as before. But the
// next time she taps Edit, the box doesn't hold her answer: it holds the words she cancelled,
// with Save ready to tap, and Read back lists them as an "Unsent draft". Cancel didn't cancel.
// (Typing in the edit box autosaves this device's draft row; Cancel unmounts the box, which
// flushes any last words to that row too. The box opens on this device's own draft when it is
// the newest row (journalRepo mergeResponses "edit" mode), so it opens on the cancelled words.)
//
// Bug D — What Esme would see: late at night (before 3am, so still "today") she is editing
// today's answer. The clock passes 3am while the box is open; she taps Save. The change isn't
// on that answer: the day's answer still shows the old words with no "Earlier version", and a
// second copy of the card appears as a new day's answer instead. (The edit box takes `today`
// from the page, which moves at 3am; Save writes saveExerciseEdit(ctx.today), the new day.)

const TODAY = "2026-10-30";
const SET = checkCardFile(FAKE_CARD_FILE)!;
const CARD1 = { id: "day-1", day: 1, theme: "Pretend weather", legacy: true };
const FIRST = "Pretend first answer about the weather";
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-v3-exercise-edit-passphrase");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
  await confirmedDevice(db, jk);
  await importExerciseCards(jk, SET, "2026-10-01");
});
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 150));
  vi.useRealTimers();
});

/** Submitted that morning, on the app's clock (so later writes are newer, as in real life). */
async function submittedThisMorning() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 30, 9, 0));
  await submitExerciseEntry(jk, TODAY, await getDeviceId(db), CARD1, FIRST);
}

async function openPastAnswer() {
  const s = await screen.findByRole("region", { name: "Mental health exercise" });
  await userEvent.click(await within(s).findByText("Past exercises"));
  const item = within(s).getByRole("list", { name: "Past exercises" }).querySelector("li")!;
  await userEvent.click(within(item).getByText(/Pretend weather/));
  return item;
}

it("Edit, type, pause, Cancel: the next Edit opens on her saved answer, not the cancelled words", async () => {
  await submittedThisMorning();
  renderApp("/journal", TODAY);
  const item = await openPastAnswer();
  await userEvent.click(within(item).getByRole("button", { name: "Edit" }));
  const box = await within(item).findByRole("textbox", { name: "Your response" });
  await userEvent.type(box, ", pretend words I then cancel");
  await new Promise((r) => setTimeout(r, 1200)); // a pause (the 800ms autosave)
  await userEvent.click(within(item).getByRole("button", { name: "Cancel" }));
  expect(within(item).getByText(FIRST)).toBeInTheDocument();
  await new Promise((r) => setTimeout(r, 300));
  await userEvent.click(within(item).getByRole("button", { name: "Edit" }));
  expect(await within(item).findByRole("textbox", { name: "Your response" })).toHaveValue(FIRST);
}, 15_000);

it("editing today's answer as 3am passes, then Save: the change is on that answer, not a new day's", async () => {
  await submittedThisMorning();
  renderApp("/journal", TODAY);
  const item = await openPastAnswer();
  await userEvent.click(within(item).getByRole("button", { name: "Edit" }));
  const box = await within(item).findByRole("textbox", { name: "Your response" });
  await userEvent.type(box, ", and a pretend late thought");
  // The clock passes 3am and the app notices (its focus / minute check).
  await act(async () => {
    vi.setSystemTime(new Date(2026, 9, 31, 3, 5));
    window.dispatchEvent(new Event("focus"));
  });
  await new Promise((r) => setTimeout(r, 300));
  await userEvent.click(within(item).getByRole("button", { name: "Save" }));
  await new Promise((r) => setTimeout(r, 500));
  const all = (await listExerciseEntries(jk, "2026-11-01")).entries;
  await waitFor(() => expect(all.map((e) => e.date)).toEqual([TODAY])); // still one answer, on its own day
  expect(all[0]!.text).toBe(`${FIRST}, and a pretend late thought`);
}, 15_000);
