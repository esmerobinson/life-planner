import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { db } from "../../data/db";
import { readCheckinDay } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { PROMPT_BY_ID } from "../../journal/prompts";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { DailyCheckIn } from "./DailyCheckIn";

// Testing session, bug: a check-in first opened after midnight (but before 3am, so still that
// day's check-in) gets MORNING questions.
//
// What Esme would see: at 1:30am, before bed, she opens the day's check-in for the first time
// and is asked things like "Describe how you're waking up today…" or "Before you reach for your
// phone, find three things…". The app-day runs 3am to 3am, but the question picker is given
// the raw clock hour (1), which counts as "morning" (before 14:00).
// Fictional setup only.

const DAY = "2026-10-29"; // the app-day; the clock says 01:30 on the 30th
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-checkin-late-night-passphrase");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear()]);
  await confirmedDevice(db, jk);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("opened first at 01:30 (still the 29th's check-in): no morning-only questions", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 30, 1, 30));
  render(
    <MemoryRouter>
      <DailyCheckIn jk={jk} today={DAY} deviceId="device-test-01" />
    </MemoryRouter>,
  );
  expect(await screen.findByRole("img", { name: /Question 1 of/ })).toBeInTheDocument();
  await waitFor(async () => expect(await db.journal.get(`set:${DAY}`)).toBeTruthy());
  const asked = (await readCheckinDay(jk, DAY)).prompts.map((id) => `${id} (${PROMPT_BY_ID.get(id)!.when})`);
  expect(asked.filter((p) => p.endsWith("(morning)"))).toEqual([]);
});
