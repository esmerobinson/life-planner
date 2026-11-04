import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import { importExerciseCards, listExerciseEntries, saveExerciseDraft } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { checkCardFile } from "../../journal/exercise";
import { getDeviceId } from "../../sync/engine";
import { FAKE_CARD_FILE } from "../../test/exerciseCards";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";

// Testing session, bug: an exercise response she typed but didn't Submit disappears from the box
// the next day (after 3am), though the same card is still today's card.
//
// What Esme would see: late in the evening she types her response to today's card and doesn't
// press Submit (or leaves the app open overnight). Next time she looks (the next app-day, from
// 3am) the same card is today's card again, but its box is EMPTY. Her words are only findable
// under Past exercises as yesterday's "Not submitted" entry. If she retypes and submits, Read
// back shows the card twice (yesterday's unsent draft and today's answer).
// Fictional cards and words only.

const DAY1 = "2026-10-30";
const DAY2 = "2026-10-31";
const WORDS = "Pretend late-night response, not submitted yet";
const SET = checkCardFile(FAKE_CARD_FILE)!;
const CARD1 = { id: "day-1", day: 1, theme: "Pretend weather", legacy: true };
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-exercise-next-day-passphrase");
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

const section = () => screen.findByRole("region", { name: "Mental health exercise" });
const todayCard = async () => within(await section()).findByRole("article", { name: "Today's card" });
const box = async () => within(await todayCard()).findByRole("textbox", { name: "Your response" });

it("next day, same card still today's card: the box opens with what she typed yesterday", async () => {
  await saveExerciseDraft(jk, DAY1, await getDeviceId(db), CARD1, WORDS);
  renderApp("/journal", DAY2);
  expect(within(await todayCard()).getByText("Pretend weather")).toBeInTheDocument(); // the same card
  expect(await box()).toHaveValue(WORDS);
});

it("the app left open past 3am with words typed: the box keeps them", async () => {
  renderApp("/journal", DAY1);
  await userEvent.type(await box(), WORDS);
  await new Promise((r) => setTimeout(r, 1200)); // autosaved
  // 03:05 the next morning: she comes back to the app (focus re-reads the clock).
  vi.setSystemTime(new Date(2026, 9, 31, 3, 5));
  await act(async () => {
    fireEvent(window, new Event("focus"));
  });
  await waitFor(async () => expect((await listExerciseEntries(jk, DAY2)).entries.map((e) => e.text)).toEqual([WORDS]));
  await new Promise((r) => setTimeout(r, 300));
  expect(within(await todayCard()).getByText("Pretend weather")).toBeInTheDocument();
  expect(await box()).toHaveValue(WORDS);
}, 15_000);
