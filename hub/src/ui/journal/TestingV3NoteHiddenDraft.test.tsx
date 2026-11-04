// Testing session (journal-v3, Notes to myself): what Esme would see.
// On the phone she starts answering "I'm too much" (not saved yet), then opens another note to
// change it, and the phone closes the app. Meanwhile on the Mac she answers "I'm too much" and
// saves. Back on the phone, the Notes tab reopens only her NEWEST note in progress (the other
// note). Her half-written "I'm too much" answer is nowhere: the prompt now shows the Mac's note,
// so there is no "+ Write your answer" link to reopen it, and saving the other note doesn't bring
// it back. The words are kept (sealed draft) and only show again the next time the tab opens.
// Fictional words only.

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import { listNotes, newNoteId, saveNote, saveNoteDraft } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";
import { getDeviceId } from "../../sync/engine";

const TODAY = "2026-11-04";
const MAC = "device-mac-00001";
const PROMPT = "I'm too much";
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-journal-passphrase-testing-v3-draft");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const section = () => screen.findByRole("region", { name: "Notes to myself" });
const tick = () => new Promise((r) => setTimeout(r, 5));

it("two notes in progress on this device: the older one is still on screen once the newer one is saved", async () => {
  await confirmedDevice(db, jk);
  const me = await getDeviceId(db);
  // An earlier note of hers (own thought), saved.
  const other = await saveNote(jk, TODAY, me, { prompt: null, thought: "Pretend own worry", steady: "Pretend own answer", memory: "", skill: "" });
  // Phone: a new answer to "I'm too much", half written (kept as this device's draft).
  await tick();
  await saveNoteDraft(jk, me, newNoteId(TODAY), { prompt: PROMPT, thought: PROMPT, steady: "Pretend half answer, people stayed", memory: "", skill: "" }, []);
  // Phone: then a change to the other note, also not saved (newer draft).
  await tick();
  await saveNoteDraft(jk, me, other, { prompt: null, thought: "Pretend own worry", steady: "Pretend own answer, changed", memory: "", skill: "" }, (await listNotes(jk)).notes[0]!.seen);
  // Mac (synced in): her answer to the same prompt.
  await saveNote(jk, TODAY, MAC, { prompt: PROMPT, thought: PROMPT, steady: "Pretend Mac answer", memory: "", skill: "" });
  expect((await listNotes(jk, me)).drafts.map((d) => d.fields.steady)).toEqual(["Pretend own answer, changed", "Pretend half answer, people stayed"]);

  renderApp("/journal/notes", TODAY);
  const s = await section();
  const form = await within(s).findByRole("form", { name: "Your note" });
  expect(within(form).getByRole("textbox", { name: "What I know when I'm steady…" })).toHaveValue("Pretend own answer, changed");
  await userEvent.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(within(s).queryByRole("form")).toBeNull());
  const group = within(s).getByRole("group", { name: "Self-worth" });
  expect(within(group).getByText("Pretend Mac answer")).toBeInTheDocument();
  // Fails: her half answer is in a draft row, but nothing on the page shows it or opens it.
  const reachable =
    within(s).queryAllByDisplayValue("Pretend half answer, people stayed").length > 0 ||
    within(group).queryByRole("button", { name: `+ Write your answer: ${PROMPT}` }) !== null;
  expect(reachable).toBe(true);
});
