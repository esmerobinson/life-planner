import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { db } from "../../data/db";
import { ensureCheckinSet, saveAnswer } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { DailyCheckIn } from "./DailyCheckIn";

// Testing session (journal-v3), the finished Daily check-in's "Edit". Fictional words only.
//
// Bug A — What Esme would see: her check-in is finished. She taps Edit, selects one answer and
// deletes it to write it again, then stops to think. Less than a second later that whole
// question and its box vanish from the page, so there is nowhere to write the new answer.
// (The 800ms autosave stores the empty answer; the day is re-read, and the finished view only
// lists questions with an answer (answeredPrompts), so the box she is typing in is unmounted.)
//
// Bug B — What Esme would see (Mac and phone): she tweaks an answer on the Mac (Edit, a few
// words, Save) and leaves the tab open. Later she changes the same answer on her phone. The
// Mac keeps showing the Mac's older words; the phone's newer answer never appears there. If she
// then taps Edit on the Mac and adds a word, the Mac's old words become the newest answer and
// the phone's answer is hidden everywhere (Past check-ins and Read back show only the newest).
// (CheckedIn keeps `mine`, what this device saved, and shows it before the stored answer for
// as long as the view is mounted.)

//
// Bug E — What Esme would see (Mac and phone): she answered a question on her phone. On the Mac
// she taps Edit, deletes that answer and taps Save; it reads as empty. Next time she opens
// the check-in (reload, or another day's visit), the phone's words are back as her answer.
// (Clearing writes an empty answer on the Mac's own row; the day's answer is "the newest
// NON-EMPTY answer from any device" (journalRepo mergeAnswer), so an empty one never wins.)

const TODAY = "2026-10-28";
const ME = "device-mac-test-01";
const PHONE = "device-phone-test-01";
const WORDS = ["Pretend: the kettle and the rain", "Pretend: I asked for help", "Pretend: a warm bath"];
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-v3-checkin-edit-passphrase");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear()]);
  await confirmedDevice(db, jk);
  await ensureCheckinSet(jk, TODAY, ["M1", "D3", "K2"]);
});
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 100));
  vi.useRealTimers();
});

function open() {
  render(
    <MemoryRouter>
      <DailyCheckIn jk={jk} today={TODAY} deviceId={ME} />
    </MemoryRouter>,
  );
}

it("Edit, clear one answer to rewrite it, pause: its box stays so she can write the new answer", async () => {
  for (const [i, id] of ["M1", "D3", "K2"].entries()) await saveAnswer(jk, TODAY, id, ME, WORDS[i]!, true);
  open();
  await screen.findByText("Checked in for today");
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  const boxes = screen.getAllByRole("textbox", { name: "Your answer" });
  expect(boxes).toHaveLength(3);
  await userEvent.clear(boxes[1]!);
  await new Promise((r) => setTimeout(r, 1500)); // she stops to think (longer than the 800ms autosave)
  // Still three boxes, the second one empty and ready for her new words.
  expect(screen.getAllByRole("textbox", { name: "Your answer" })).toHaveLength(3);
}, 15_000);

it("Mac edited earlier, then the phone changes the same answer: the Mac shows the phone's newer words", async () => {
  for (const [i, id] of ["M1", "D3", "K2"].entries()) await saveAnswer(jk, TODAY, id, ME, WORDS[i]!, true);
  open();
  await screen.findByText("Checked in for today");
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  await userEvent.type(screen.getAllByRole("textbox", { name: "Your answer" })[2]!, ", on the Mac");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await new Promise((r) => setTimeout(r, 300));
  // Later, on the phone, the same answer is changed; sync brings the phone's row here.
  await saveAnswer(jk, TODAY, "K2", PHONE, "Pretend: a warm bath, then changed on the phone", true);
  await waitFor(
    () => expect(screen.getAllByLabelText("Your answer").map((a) => a.textContent)[2]).toBe("Pretend: a warm bath, then changed on the phone"),
    { timeout: 2000 },
  );
}, 15_000);

it("an answer written on the phone, cleared on the Mac with Edit and Save: it stays cleared after a reload", async () => {
  await saveAnswer(jk, TODAY, "M1", PHONE, "Pretend phone answer I later delete", true);
  await saveAnswer(jk, TODAY, "D3", ME, WORDS[1]!, true);
  await saveAnswer(jk, TODAY, "K2", ME, WORDS[2]!, true);
  open();
  await screen.findByText("Checked in for today");
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  await userEvent.clear(screen.getAllByRole("textbox", { name: "Your answer" })[0]!);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await new Promise((r) => setTimeout(r, 300));
  cleanup(); // she comes back later
  open();
  await screen.findByText("Checked in for today");
  expect(screen.queryByText("Pretend phone answer I later delete")).toBeNull();
}, 15_000);
