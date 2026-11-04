import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import { ensureCheckinSet, readCheckinDay } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";

// Testing session, bug: daily check-in answers lost when she pauses before Next / Finish.
// The answer autosaves after a pause (800ms); the page re-reads the day, so the box now
// matches what is stored and counts as "untouched"; Next then writes an EMPTY answer over
// this device's own row. Fictional words only.

const TODAY = "2026-10-28";
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-checkin-pause-passphrase");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear()]);
});
afterEach(() => {
  vi.useRealTimers();
});

const section = () => screen.findByRole("region", { name: "Daily check-in" });
const pause = () => new Promise((r) => setTimeout(r, 1500)); // longer than the 800ms autosave

describe("daily check-in: pausing before Next keeps the answer", () => {
  it("type, pause, Next: the answer is still there in the store", async () => {
    await confirmedDevice(db, jk);
    await ensureCheckinSet(jk, TODAY, ["M1", "D3", "K2"]);
    renderApp("/journal/check-in", TODAY);
    const s = await section();
    await userEvent.type(await within(s).findByLabelText("Your answer"), "Pretend answer after a pause");
    await pause();
    await waitFor(async () =>
      expect((await readCheckinDay(jk, TODAY)).answers.get("M1")?.answer).toBe("Pretend answer after a pause"),
    );
    await userEvent.click(within(s).getByRole("button", { name: "Next →" }));
    expect(await within(s).findByRole("img", { name: "Question 2 of 3" })).toBeInTheDocument();
    await waitFor(async () => expect((await readCheckinDay(jk, TODAY)).answers.get("M1")?.done).toBe(true));
    expect((await readCheckinDay(jk, TODAY)).answers.get("M1")?.answer).toBe("Pretend answer after a pause");
  }, 15_000);

  it("type, pause, Finish on every question: 'Checked in for today' shows each answer, not empty boxes", async () => {
    await confirmedDevice(db, jk);
    await ensureCheckinSet(jk, TODAY, ["M1", "D3", "K2"]);
    renderApp("/journal/check-in", TODAY);
    const s = await section();
    const words = ["Pretend one", "Pretend two", "Pretend three"];
    for (let i = 0; i < 3; i++) {
      await within(s).findByRole("img", { name: `Question ${i + 1} of 3` });
      await userEvent.type(within(s).getByLabelText("Your answer"), words[i]!);
      await pause();
      await userEvent.click(within(s).getByRole("button", { name: i === 2 ? "Finish" : "Next →" }));
    }
    expect(await within(s).findByText("Checked in for today")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(s).getAllByLabelText("Your answer").map((b) => (b as HTMLTextAreaElement).value)).toEqual(words),
    );
  }, 20_000);
});
