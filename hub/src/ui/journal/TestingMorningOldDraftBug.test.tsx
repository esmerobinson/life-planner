import { cleanup, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { db } from "../../data/db";
import { listReadBack, readMorningDay, saveMorningDraft } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { getDeviceId } from "../../sync/engine";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";

// Testing session, bug: an unfinished morning page more than one day old is never shown again.
//
// What Esme would see: she writes morning pages on Monday but doesn't press "I'm done" (she's
// interrupted). She doesn't open Morning pages on Tuesday. On Wednesday the box is empty, there
// is no "unfinished page is saved" line and no way to open Monday's words: they are saved on
// this device but nothing in the app ever shows them again (Read back lists finished pages
// only). Same if she saw "Yesterday's unfinished page is saved" on Tuesday and left it.
// Fictional words only.

const MONDAY = "2026-11-02";
const WEDNESDAY = "2026-11-04";
const WORDS = "Pretend Monday morning words, never finished";
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-morning-old-draft-passphrase");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
  await confirmedDevice(db, jk);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("a page left unfinished two days ago is still offered (not silently hidden)", async () => {
  await saveMorningDraft(jk, MONDAY, await getDeviceId(db), WORDS);
  // The words are stored (sealed) on this device...
  expect((await readMorningDay(jk, MONDAY, await getDeviceId(db))).draft).toBe(WORDS);
  expect(await listReadBack()).toEqual([]); // ...and Read back has no place for a draft.

  renderApp("/journal/morning", WEDNESDAY);
  expect(await screen.findByLabelText("Today's morning page")).toHaveValue("");
  // Some way back to Monday's words: the "unfinished page is saved" line (and its Open button).
  await waitFor(() => expect(screen.getByText(/unfinished page/i)).toBeInTheDocument(), { timeout: 2000 });
});
