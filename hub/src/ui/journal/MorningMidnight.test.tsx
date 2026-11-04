import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import { readMorningDay } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { getDeviceId } from "../../sync/engine";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";
import { YESTERDAY_SAVED } from "./MorningPages";

// Morning pages across midnight (review I1): a page is never filed under the day the tab was
// opened. At the rollover nothing is finished by itself: yesterday's unsent words stay
// yesterday's draft, and today starts with a fresh box and a small line saying so.
// Fictional words only.

const PASS = "fake-journal-passphrase-for-tests";
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor(PASS);
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
  await confirmedDevice(db, jk);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The clock moves past the day's end (3am) and the app notices (as on focus, visibility or its minute check). */
async function pastMidnight() {
  await act(async () => {
    vi.setSystemTime(new Date(2026, 10, 2, 3, 5));
    window.dispatchEvent(new Event("focus"));
  });
}

it("opened yesterday, written today: the page is today's", async () => {
  renderApp("/journal/morning", "2026-11-01");
  await screen.findByLabelText("Today's morning page");
  await pastMidnight();
  await userEvent.type(await screen.findByLabelText("Today's morning page"), "Pretend fresh morning words");
  await userEvent.click(screen.getByRole("button", { name: "I'm done" }));
  const device = await getDeviceId(db);
  await waitFor(async () => expect((await readMorningDay(jk, "2026-11-02", device)).pages).toBe(1));
  expect((await readMorningDay(jk, "2026-11-01", device)).pages).toBe(0);
  expect(screen.queryByText(YESTERDAY_SAVED)).toBeNull(); // nothing was written yesterday
});

it("written yesterday, not finished: kept as yesterday's draft; today starts empty with a small line", async () => {
  renderApp("/journal/morning", "2026-11-01");
  await userEvent.type(await screen.findByLabelText("Today's morning page"), "Pretend late words");
  await pastMidnight();
  const device = await getDeviceId(db);
  await waitFor(async () => expect((await readMorningDay(jk, "2026-11-01", device)).draft).toBe("Pretend late words"));
  expect(await screen.findByText(YESTERDAY_SAVED)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText("Today's morning page")).toHaveValue(""));
  expect((await readMorningDay(jk, "2026-11-01", device)).pages).toBe(0); // nothing finished by itself
  await userEvent.type(screen.getByLabelText("Today's morning page"), "Pretend new words");
  await userEvent.click(screen.getByRole("button", { name: "I'm done" }));
  await waitFor(async () => expect((await readMorningDay(jk, "2026-11-02", device)).pages).toBe(1));
  expect((await readMorningDay(jk, "2026-11-01", device)).draft).toBe("Pretend late words");
});

it("I'm done pressed after midnight before the app noticed: not filed under yesterday; today's box opens with the line", async () => {
  renderApp("/journal/morning", "2026-11-01");
  await userEvent.type(await screen.findByLabelText("Today's morning page"), "Pretend words");
  vi.setSystemTime(new Date(2026, 10, 2, 3, 1)); // no focus event yet (a day ends at 3am)
  await userEvent.click(screen.getByRole("button", { name: "I'm done" }));
  const device = await getDeviceId(db);
  expect(await screen.findByText(YESTERDAY_SAVED)).toBeInTheDocument();
  expect((await readMorningDay(jk, "2026-11-01", device)).pages).toBe(0);
  expect((await readMorningDay(jk, "2026-11-01", device)).draft).toBe("Pretend words");
});
