import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { db } from "../../data/db";
import { ensureCheckinSet, readCheckinDay, saveAnswer } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { DailyCheckIn } from "./DailyCheckIn";

// Testing session, verifying bug #40 (2026-11-05) on Esme's exact case: the old Mac app saved
// all three of today's answers as blank and moved past them (answer null, done, no "skipped"
// marker). The finished check-in must still show every question, say no answer was saved,
// offer Edit, and keep what she writes there. Fictional words.

const TODAY = "2026-11-05";
const MAC = "device-mac-blank-01";
const IDS = ["M1", "D3", "K2"];
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-blank-day-passphrase");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear()]);
  await confirmedDevice(db, jk);
  await ensureCheckinSet(jk, TODAY, IDS);
  for (const id of IDS) await saveAnswer(jk, TODAY, id, MAC, null, true); // what the old app wrote
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

it("all three answers blanked by the old app: every question shows, 'No answer saved', Edit; she rewrites them and they stay after a reload", async () => {
  open();
  await screen.findByText("Checked in for today");
  expect(screen.getAllByText("No answer saved")).toHaveLength(3);
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  const boxes = screen.getAllByRole("textbox", { name: "Your answer" });
  expect(boxes).toHaveLength(3);
  const words = ["Pretend rewritten one", "Pretend rewritten two", "Pretend rewritten three"];
  for (let i = 0; i < 3; i++) await userEvent.type(boxes[i]!, words[i]!);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await new Promise((r) => setTimeout(r, 300));
  const day = await readCheckinDay(jk, TODAY);
  expect(IDS.map((id) => day.answers.get(id)?.answer)).toEqual(words);
  cleanup(); // she comes back later
  open();
  await screen.findByText("Checked in for today");
  expect(screen.getAllByLabelText("Your answer").map((a) => a.textContent)).toEqual(words);
  expect(screen.queryByText("No answer saved")).toBeNull();
  expect(within(document.body).getByRole("button", { name: "Edit" })).toBeInTheDocument();
}, 20_000);
