import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import { importExerciseCards, submitExerciseEntry } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { checkCardFile } from "../../journal/exercise";
import { getDeviceId } from "../../sync/engine";
import { FAKE_CARD_FILE } from "../../test/exerciseCards";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";

// Testing session, bug: clearing a submitted exercise response to rewrite it, the old words
// jump back into the box.
//
// What Esme would see: today's card shows her submitted response ("Saved"). She wants to start
// again, so she selects it all and deletes it, then stops to think. Less than a second later
// the old response is back in the box. (The autosave stores the empty draft; the box re-reads
// the card, and an empty draft "has nothing written", so the newest row WITH words, her
// submitted one, is shown again and taken into the box because nothing typed is waiting.)
// Fictional cards and words only.

const TODAY = "2026-10-30";
const SET = checkCardFile(FAKE_CARD_FILE)!;
const CARD1 = { id: "day-1", day: 1, theme: "Pretend weather", legacy: true };
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-exercise-clear-passphrase");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
  await confirmedDevice(db, jk);
  await importExerciseCards(jk, SET, "2026-10-01");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("submitted, then cleared to rewrite and a pause: the box stays empty", async () => {
  await submitExerciseEntry(jk, TODAY, await getDeviceId(db), CARD1, "Pretend first go at this card");
  renderApp("/journal", TODAY);
  const s = await screen.findByRole("region", { name: "Mental health exercise" });
  const card = await within(s).findByRole("article", { name: "Today's card" });
  const box = await within(card).findByRole("textbox", { name: "Your response" });
  expect(box).toHaveValue("Pretend first go at this card");
  await userEvent.clear(box);
  await new Promise((r) => setTimeout(r, 1500)); // she stops to think (longer than the 800ms autosave)
  expect(within(card).getByRole("textbox", { name: "Your response" })).toHaveValue("");
}, 15_000);
