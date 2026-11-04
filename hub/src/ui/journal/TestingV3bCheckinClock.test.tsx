import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { db } from "../../data/db";
import { ensureCheckinSet, saveAnswer } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { DailyCheckIn } from "./DailyCheckIn";

// Testing session (journal-v3 round 2 recheck), the finished Daily check-in's Edit, two devices
// whose clocks differ (here the phone's clock is 5 minutes ahead of the Mac's). Fictional words.
//
// What Esme would see: she answered a question on her phone. A minute later, on the Mac, she
// taps Edit, sees the phone's answer, changes it (or clears it) and taps Save. The Mac shows
// her change for a moment, then the phone's old words come back into the box / the read-only
// answer, on every device, after every reload. Her Mac words are stored but never shown
// anywhere (Past check-ins and Read back show the phone's answer too). A clear (bug #30) never
// sticks either.
// Cause: journalRepo.ts saveAnswer stamps an Edit row with this device's Date.now() only, and
// mergeAnswer picks the answer with the larger `at`. Unlike saveExerciseEdit (at = max(now,
// every version + 1)) and notes (`seen`), nothing makes an Edit newer than the answer she
// had in front of her, so the device with the slower clock always loses.

const TODAY = "2026-10-28";
const MAC = "device-mac-test-01";
const PHONE = "device-phone-test-01";
const PHONE_AHEAD_MS = 5 * 60_000;
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-v3b-checkin-clock-passphrase");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear()]);
  await confirmedDevice(db, jk);
  await ensureCheckinSet(jk, TODAY, ["M1", "D3", "K2"]);
});
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 100));
  vi.restoreAllMocks();
});

function open() {
  render(
    <MemoryRouter>
      <DailyCheckIn jk={jk} today={TODAY} deviceId={MAC} />
    </MemoryRouter>,
  );
}

/** The phone answers every question, its clock 5 minutes ahead (then sync brings the rows here). */
async function phoneAnswers(first: string) {
  const real = Date.now.bind(Date);
  const spy = vi.spyOn(Date, "now").mockImplementation(() => real() + PHONE_AHEAD_MS);
  await saveAnswer(jk, TODAY, "M1", PHONE, first, true);
  await saveAnswer(jk, TODAY, "D3", PHONE, "Pretend phone answer two", true);
  await saveAnswer(jk, TODAY, "K2", PHONE, "Pretend phone answer three", true);
  spy.mockRestore();
}

it("phone clock ahead: she changes the phone's answer on the Mac with Edit and Save; after a reload her change shows", async () => {
  await phoneAnswers("Pretend phone answer one");
  open();
  await screen.findByText("Checked in for today");
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  const box = screen.getAllByRole("textbox", { name: "Your answer" })[0]!;
  expect(box).toHaveValue("Pretend phone answer one");
  await userEvent.type(box, ", changed on the Mac");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await new Promise((r) => setTimeout(r, 300));
  cleanup(); // she comes back later
  open();
  await screen.findByText("Checked in for today");
  const shown = screen.getAllByLabelText("Your answer").map((a) => a.textContent);
  // Fails: shows "Pretend phone answer one" (the phone's row has the larger `at`).
  expect(shown[0]).toBe("Pretend phone answer one, changed on the Mac");
}, 15_000);

it("phone clock ahead: she adds words on the Mac with Edit and pauses; her words stay in the box", async () => {
  await phoneAnswers("Pretend phone answer one");
  open();
  await screen.findByText("Checked in for today");
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  await userEvent.type(screen.getAllByRole("textbox", { name: "Your answer" })[0]!, " plus a Mac thought");
  await new Promise((r) => setTimeout(r, 1500)); // she stops to think (longer than the 800ms autosave)
  // Fails: the box now holds "Pretend phone answer one" again (the re-read day's newest by clock).
  expect(screen.getAllByRole("textbox", { name: "Your answer" })[0]).toHaveValue("Pretend phone answer one plus a Mac thought");
}, 15_000);

it("phone clock ahead: she clears the phone's answer on the Mac with Edit and Save; after a reload it stays cleared", async () => {
  await phoneAnswers("Pretend phone answer I later delete");
  open();
  await screen.findByText("Checked in for today");
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  await userEvent.clear(screen.getAllByRole("textbox", { name: "Your answer" })[0]!);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await new Promise((r) => setTimeout(r, 300));
  cleanup();
  open();
  await screen.findByText("Checked in for today");
  // Fails: the phone's words are back.
  expect(screen.queryByText("Pretend phone answer I later delete")).toBeNull();
}, 15_000);
