import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { db } from "../../data/db";
import { ensureCheckinSet, readCheckinDay, saveAnswer } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { DailyCheckIn } from "./DailyCheckIn";

// Testing session, guard (after checkin-clock @dc26e03): the finished Daily check-in's Edit on
// the Mac while the phone changes the same answer, with the two clocks in step. What Esme
// should see: whatever she Saves last, on the Mac, is the answer everywhere. Fictional words.
// (With the phone's clock AHEAD, the phone's words can still win here; that case is noted in
// bugs.md, not tested: it needs her editing on two devices at once and a wrong clock.)

const TODAY = "2026-10-28";
const MAC = "device-mac-test-02";
const PHONE = "device-phone-test-02";
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-midedit-checkin-passphrase");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear()]);
  await confirmedDevice(db, jk);
  await ensureCheckinSet(jk, TODAY, ["M1", "D3", "K2"]);
  await saveAnswer(jk, TODAY, "M1", PHONE, "Pretend phone first answer", true);
  await saveAnswer(jk, TODAY, "D3", PHONE, "Pretend phone answer two", true);
  await saveAnswer(jk, TODAY, "K2", PHONE, "Pretend phone answer three", true);
});
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 100));
  vi.restoreAllMocks();
});

const open = () =>
  render(
    <MemoryRouter>
      <DailyCheckIn jk={jk} today={TODAY} deviceId={MAC} />
    </MemoryRouter>,
  );

it("Mac mid-edit, the phone changes the same answer, then she Saves on the Mac: her Mac words are the answer after a reload", async () => {
  open();
  await screen.findByText("Checked in for today");
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  const box = screen.getAllByRole("textbox", { name: "Your answer" })[0]!;
  await userEvent.type(box, ", and more from the Mac");
  // The phone changes the same answer meanwhile; sync brings it in.
  await new Promise((r) => setTimeout(r, 20));
  await act(async () => {
    await saveAnswer(jk, TODAY, "M1", PHONE, "Pretend phone changed its mind", true);
  });
  await userEvent.type(screen.getAllByRole("textbox", { name: "Your answer" })[0]!, " (last word)");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await new Promise((r) => setTimeout(r, 300));
  const stored = (await readCheckinDay(jk, TODAY)).answers.get("M1")?.answer ?? "";
  expect(stored).toContain("and more from the Mac");
  expect(stored).toContain("(last word)");
  cleanup();
  open();
  await screen.findByText("Checked in for today");
  expect(screen.getAllByLabelText("Your answer")[0]!.textContent).toContain("(last word)");
}, 15_000);

it("Mac mid-edit with a pause (autosaved), the phone changes the same answer, she types on and Saves: her Mac words are still in the box and the answer", async () => {
  open();
  await screen.findByText("Checked in for today");
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  const box = screen.getAllByRole("textbox", { name: "Your answer" })[0]!;
  await userEvent.type(box, ", and more from the Mac");
  await new Promise((r) => setTimeout(r, 1200)); // she pauses to think: the box autosaves
  await act(async () => {
    await saveAnswer(jk, TODAY, "M1", PHONE, "Pretend phone changed its mind", true);
  });
  await new Promise((r) => setTimeout(r, 300));
  expect(screen.getAllByRole("textbox", { name: "Your answer" })[0]).toHaveValue("Pretend phone first answer, and more from the Mac");
  await userEvent.type(screen.getAllByRole("textbox", { name: "Your answer" })[0]!, " (last word)");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await new Promise((r) => setTimeout(r, 300));
  const stored = (await readCheckinDay(jk, TODAY)).answers.get("M1")?.answer ?? "";
  expect(stored).toBe("Pretend phone first answer, and more from the Mac (last word)");
}, 15_000);
