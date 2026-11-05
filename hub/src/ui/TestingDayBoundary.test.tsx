import { act, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { db } from "../data/db";
import type { JournalKey } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { renderApp } from "../test/renderApp";

// Testing session: the 3am day change while the app stays open. Fictional data only.
// Cause: ui/journal/MorningPages.tsx:49 `useState(today.slice(0, 7))` is set once and never
// follows `today`, so the shown month stays the one the tab was opened in.

const PASS = "fake-journal-passphrase-for-tests";
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor(PASS);
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function clockTo(d: Date) {
  await act(async () => {
    vi.setSystemTime(d);
    window.dispatchEvent(new Event("focus"));
  });
}

describe("Morning pages calendar across a month end", () => {
  // What Esme would see: she leaves the Journal's Morning pages tab open on 31 October. After
  // 3am on 1 November the app moves to the new day (the box is today's), but the calendar under
  // it still shows October, so today (1 November) isn't on it and isn't outlined.
  it("left open past 3am on the 1st, the calendar moves to the new month", async () => {
    await confirmedDevice(db, jk);
    renderApp("/journal/morning", "2026-10-31");
    await screen.findByLabelText("Today's morning page");
    const label = () => document.querySelector(".journal-month-row b")?.textContent;
    expect(label()).toBe("October");
    await clockTo(new Date(2026, 10, 1, 3, 5));
    await screen.findByLabelText("Today's morning page");
    await waitFor(() => expect(label()).toBe("November"));
  });
});

