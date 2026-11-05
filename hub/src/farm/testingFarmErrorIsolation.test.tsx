// Testing session (farm x journal): an INJECTED farm fault. If the farm's counting throws (here:
// pretend, the moment the journal's facts arrive after a check-in), the Journal must stay on
// screen. There is no error boundary anywhere in the app (grep ErrorBoundary/componentDidCatch:
// none), and FarmProvider wraps the whole shell (AppShell.tsx), so any throw in farm render
// code takes the Journal down with it. No real data found that makes counters() throw; this
// proves only that nothing contains a farm error if one ever happens. Fictional words only.

import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import { ensureCheckinSet, readCheckinDay } from "../data/repo";
import type { JournalKey } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { renderApp } from "../test/renderApp";
import { startRow } from "./state";

vi.mock("./earning", async (orig) => {
  const m = await orig<typeof import("./earning")>();
  return {
    ...m,
    counters: (input: Parameters<typeof m.counters>[0]) => {
      if (input.journal && input.journal.checkins.size > 0) throw new Error("pretend farm fault");
      return m.counters(input);
    },
  };
});

const TODAY = "2026-10-28";
const WORDS = ["Pretend: a teapot", "Pretend: a kite", "Pretend: a bath"];
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-farm-isolation-passphrase");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.items.clear(), db.farm.clear(), db.pending.clear(), db.syncMeta.clear()]);
  await confirmedDevice(db, jk);
  await db.farm.put(startRow("devicePretend01", "2026-10-27"));
});
afterEach(async () => {
  cleanup();
  await pause(150);
  vi.useRealTimers();
});

it("a farm error after Finish leaves the finished check-in on screen (the Journal is never taken down by the farm)", async () => {
  const swallow = (e: ErrorEvent) => e.preventDefault(); // React reports the render error; keep it from failing the run by itself
  window.addEventListener("error", swallow);
  const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    await ensureCheckinSet(jk, TODAY, ["M1", "D3", "K2"]);
    renderApp("/journal/check-in", TODAY);
    const s = await screen.findByRole("region", { name: "Daily check-in" });
    for (let i = 0; i < WORDS.length; i++) {
      await within(s).findByRole("img", { name: `Question ${i + 1} of ${WORDS.length}` });
      await userEvent.type(within(s).getByLabelText("Your answer"), WORDS[i]!);
      await userEvent.click(within(s).getByRole("button", { name: i === WORDS.length - 1 ? "Finish" : "Next →" }));
    }
    expect(await within(s).findByText("Checked in for today")).toBeInTheDocument();
    // The answers were saved before the farm counted them.
    const day = await readCheckinDay(jk, TODAY);
    expect(day.prompts.map((p) => day.answers.get(p)?.answer)).toEqual(WORDS);
    await pause(3000); // the farm's journal re-read (2 s) brings the fault
    expect(screen.queryByText("Checked in for today")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Journal" })).toBeInTheDocument();
  } finally {
    window.removeEventListener("error", swallow);
    quiet.mockRestore();
  }
}, 30_000);
