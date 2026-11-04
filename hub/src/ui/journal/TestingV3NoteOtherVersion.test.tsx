// Testing session (journal-v3, Notes to myself): what Esme would see.
// She wrote the same note on the Mac and on the phone without them syncing in between. The
// Notes tab shows the newest words, and under them "Another version (from …)" with the other
// device's words. She taps Edit to bring the two together: the other version DISAPPEARS the
// moment the editor opens (the editor holds only the newest words), so she can't read or copy
// it while she writes. When she presses Save, her new version is written "over" the other one
// (it is in `seen`), so the other device's words are gone from every screen for good.
// Also: the Hard moment view never shows another version at all.
// Fictional words only.

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import { listNotes, saveNote } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";

const TODAY = "2026-11-04";
const MAC = "device-mac-00001";
const PHONE = "device-phone-001";
const fields = { prompt: null, memory: "", skill: "" };
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-journal-passphrase-testing-v3");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const section = () => screen.findByRole("region", { name: "Notes to myself" });

/** One note, edited on the Mac and on the phone without either seeing the other's words. */
async function twoVersions() {
  await confirmedDevice(db, jk);
  const id = await saveNote(jk, TODAY, MAC, { ...fields, thought: "Pretend worry", steady: "Pretend first words" });
  const base = (await listNotes(jk)).notes[0]!.seen;
  await saveNote(jk, TODAY, MAC, { ...fields, thought: "Pretend worry", steady: "Pretend Mac words" }, { id, seen: base });
  await new Promise((r) => setTimeout(r, 5)); // the phone's is newer, so it shows on top
  await saveNote(jk, TODAY, PHONE, { ...fields, thought: "Pretend worry", steady: "Pretend phone words" }, { id, seen: base });
  const [n] = (await listNotes(jk)).notes;
  expect(n!.steady).toBe("Pretend phone words");
  expect(n!.others.map((o) => o.steady)).toEqual(["Pretend Mac words"]);
}

it("Edit on a note with another version: the other version's words stay on screen while she writes", async () => {
  await twoVersions();
  renderApp("/journal/notes", TODAY);
  const own = await within(await section()).findByRole("group", { name: "My own thoughts" });
  expect(await within(own).findByText("Pretend Mac words")).toBeInTheDocument();
  await userEvent.click(within(own).getByRole("button", { name: "Edit: Pretend worry" }));
  await within(own).findByRole("form", { name: "Your note" });
  // Fails: the editor replaces the whole strip, and "Another version" goes with it.
  expect(within(own).queryByText("Pretend Mac words")).not.toBeNull();
});

it("Edit then Save (a small change to the shown words): the other device's words are still somewhere she can read them", async () => {
  await twoVersions();
  renderApp("/journal/notes", TODAY);
  const s = await section();
  const own = await within(s).findByRole("group", { name: "My own thoughts" });
  await userEvent.click(await within(own).findByRole("button", { name: "Edit: Pretend worry" }));
  const form = within(own).getByRole("form", { name: "Your note" });
  await userEvent.type(within(form).getByRole("textbox", { name: "What I know when I'm steady…" }), ", fixed a typo");
  await userEvent.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(within(s).queryByRole("form")).toBeNull());
  expect(await within(own).findByText("Pretend phone words, fixed a typo")).toBeInTheDocument();
  // Fails: "Pretend Mac words" was never in the editor, and Save marked it as written over.
  const notes = (await listNotes(jk)).notes;
  const everywhere = JSON.stringify(notes);
  expect(everywhere).toContain("Pretend Mac words");
});

it("Hard moment: a note's other version is shown too, not only the newest", async () => {
  await twoVersions();
  renderApp("/journal/notes", TODAY);
  await userEvent.click(await screen.findByRole("button", { name: "Hard moment" }));
  const view = await screen.findByRole("dialog", { name: "Notes to myself" });
  expect(await within(view).findByText("Pretend phone words")).toBeInTheDocument();
  // Fails: HardMomentView renders NoteBody only, never note.others.
  expect(within(view).queryByText("Pretend Mac words")).not.toBeNull();
});
