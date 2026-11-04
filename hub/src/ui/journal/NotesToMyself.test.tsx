import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import { deleteNote, listNoteReads, listNotes, saveNote, setNoteRead } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { NOTE_GROUPS } from "../../journal/notes";
import { confirmedDevice, keyFor, verifierRow } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";
import { getDeviceId } from "../../sync/engine";
import { DELETED_ELSEWHERE } from "./NotesToMyself";

// Notes to myself (journal v3): a Journal tab where, while steady, she writes her own answers
// to the thoughts that come up in hard moments; one or two come up to reread each day; "Hard
// moment" opens them all at once from any Journal tab. Fictional words only.

const PASS = "fake-journal-passphrase-for-tests";
const TODAY = "2026-11-04";
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

const section = () => screen.findByRole("region", { name: "Notes to myself" });
/** Another of her devices (the notes it wrote arrive by sync). */
const OTHER = "device-phone-01";
const fields = { prompt: null, memory: "", skill: "" };

it("locked: the tab is there but no notes and no Hard moment button", async () => {
  await db.journal.put(await verifierRow(jk));
  renderApp("/journal/notes", TODAY);
  expect(await screen.findByRole("heading", { name: "Unlock journal" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Notes to myself" })).toHaveAttribute("aria-current", "page");
  expect(screen.queryByRole("region", { name: "Notes to myself" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Hard moment" })).toBeNull();
});

it("the tab never ticks and shows no streak; it isn't a row on Home", async () => {
  await confirmedDevice(db, jk);
  await saveNote(jk, TODAY, OTHER, { ...fields, thought: "Pretend thought", steady: "Pretend answer" });
  const view = renderApp("/journal/notes", TODAY);
  await section();
  const tab = screen.getByRole("link", { name: "Notes to myself" });
  expect(tab.querySelector(".tick-auto, .tick-auto-space")).toBeNull();
  expect(tab.querySelector(".streak")).toBeNull();
  view.unmount();
  renderApp("/", TODAY);
  expect(await screen.findByText("Morning pages")).toBeInTheDocument();
  expect(screen.queryByText("Notes to myself")).toBeNull();
});

it("shows the nine groups with every starter prompt, each with + Write your answer, and + My own thought", async () => {
  await confirmedDevice(db, jk);
  renderApp("/journal/notes", TODAY);
  const s = await section();
  for (const g of NOTE_GROUPS) {
    const group = await within(s).findByRole("group", { name: g.title });
    for (const p of g.prompts) {
      const row = within(group).getByText(p).closest("li")!;
      expect(within(row).getByRole("button", { name: `+ Write your answer: ${p}` })).toHaveClass("quiet-link");
    }
  }
  expect(within(s).getByRole("button", { name: "+ My own thought" })).toBeInTheDocument();
  // Prompts only: no answer is written for her.
  expect(within(s).queryByText(/What I know when I'm steady/)).toBeNull();
});

it("+ Write your answer: the thought is filled in, the answer is hers; Save keeps it sealed and shows it under the prompt", async () => {
  await confirmedDevice(db, jk);
  renderApp("/journal/notes", TODAY);
  const s = await section();
  await userEvent.click(await within(s).findByRole("button", { name: "+ Write your answer: Why should I care?" }));
  const form = within(s).getByRole("form", { name: "Your note" });
  expect(within(form).getByRole("textbox", { name: "When I think…" })).toHaveValue("Why should I care?");
  const answer = within(form).getByRole("textbox", { name: "What I know when I'm steady…" });
  expect(answer).toHaveValue("");
  expect(within(form).getByRole("button", { name: "Save" })).toBeDisabled();
  await userEvent.type(answer, "Pretend: the small steps added up last spring");
  await userEvent.type(within(form).getByRole("textbox", { name: "A memory or evidence (optional)" }), "Pretend walk by the made-up river");
  await userEvent.type(within(form).getByRole("textbox", { name: "A skill to try (optional)" }), "Pretend skill");
  await userEvent.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(within(s).queryByRole("form")).toBeNull());
  const group = within(s).getByRole("group", { name: "Why bother" });
  expect(await within(group).findByText("Pretend: the small steps added up last spring")).toBeInTheDocument();
  expect(within(group).getByText("Pretend walk by the made-up river")).toBeInTheDocument();
  expect(within(group).queryByRole("button", { name: "+ Write your answer: Why should I care?" })).toBeNull();
  const { notes } = await listNotes(jk);
  expect(notes).toEqual([expect.objectContaining({
    prompt: "Why should I care?", thought: "Why should I care?", steady: "Pretend: the small steps added up last spring",
    memory: "Pretend walk by the made-up river", skill: "Pretend skill",
  })]);
  expect(JSON.stringify(await db.journal.toArray())).not.toContain("small steps");
});

it("+ My own thought: an empty thought to fill; it shows under My own thoughts", async () => {
  await confirmedDevice(db, jk);
  renderApp("/journal/notes", TODAY);
  const s = await section();
  await userEvent.click(await within(s).findByRole("button", { name: "+ My own thought" }));
  const form = within(s).getByRole("form", { name: "Your note" });
  expect(within(form).getByRole("textbox", { name: "When I think…" })).toHaveValue("");
  await userEvent.type(within(form).getByRole("textbox", { name: "When I think…" }), "Pretend own worry");
  await userEvent.type(within(form).getByRole("textbox", { name: "What I know when I'm steady…" }), "Pretend own answer");
  await userEvent.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(within(s).queryByRole("form")).toBeNull());
  const own = within(s).getByRole("group", { name: "My own thoughts" });
  expect(await within(own).findByText("Pretend own worry")).toBeInTheDocument();
  expect(within(own).getByText("Pretend own answer")).toBeInTheDocument();
  expect((await listNotes(jk)).notes[0]).toMatchObject({ prompt: null });
});

it("Cancel leaves no note (and no note in progress)", async () => {
  await confirmedDevice(db, jk);
  renderApp("/journal/notes", TODAY);
  const s = await section();
  await userEvent.click(await within(s).findByRole("button", { name: "+ My own thought" }));
  await userEvent.type(within(s).getByRole("textbox", { name: "When I think…" }), "Pretend passing worry");
  await userEvent.click(within(s).getByRole("button", { name: "Cancel" }));
  expect(within(s).queryByRole("form")).toBeNull();
  await waitFor(async () => expect((await listNotes(jk, await getDeviceId(db))).drafts).toEqual([]));
  expect((await listNotes(jk)).notes).toEqual([]);
});

describe("a note in progress is never lost (review I2)", () => {
  it("typed, then another tab and back: the editor opens again with her words", async () => {
    await confirmedDevice(db, jk);
    renderApp("/journal/notes", TODAY);
    const s = await section();
    await userEvent.click(await within(s).findByRole("button", { name: "+ Write your answer: I'm too much" }));
    await userEvent.type(within(s).getByRole("textbox", { name: "What I know when I'm steady…" }), "Pretend: people stayed");
    await userEvent.click(screen.getByRole("link", { name: /Daily check-in/ })); // the tab goes away
    await screen.findByRole("region", { name: "Daily check-in" });
    await userEvent.click(screen.getByRole("link", { name: "Notes to myself" }));
    const back = await section();
    const form = await within(back).findByRole("form", { name: "Your note" });
    expect(within(form).getByRole("textbox", { name: "What I know when I'm steady…" })).toHaveValue("Pretend: people stayed");
    expect(within(form).getByRole("textbox", { name: "When I think…" })).toHaveValue("I'm too much");
    expect(JSON.stringify(await db.journal.toArray())).not.toContain("people stayed"); // kept sealed
    // Saved, it is a note under its prompt and nothing is left in progress.
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(await within(within(back).getByRole("group", { name: "Self-worth" })).findByText("Pretend: people stayed")).toBeInTheDocument();
    await waitFor(async () => expect((await listNotes(jk, await getDeviceId(db))).drafts).toEqual([]));
  });

  it("an edit typed, then the app closed (page hidden) and opened again: her words are there", async () => {
    await confirmedDevice(db, jk);
    await saveNote(jk, TODAY, OTHER, { ...fields, thought: "Pretend old thought", steady: "Pretend old answer" });
    const view = renderApp("/journal/notes", TODAY);
    const s = await section();
    await userEvent.click(await within(s).findByRole("button", { name: "Edit: Pretend old thought" }));
    const answer = within(s).getByRole("textbox", { name: "What I know when I'm steady…" });
    await userEvent.type(answer, ", and more pretend words");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await waitFor(async () => expect((await listNotes(jk, await getDeviceId(db))).drafts).toHaveLength(1));
    view.unmount(); // iOS ends the app
    renderApp("/journal/notes", TODAY);
    const form = await within(await section()).findByRole("form", { name: "Your note" });
    expect(within(form).getByRole("textbox", { name: "What I know when I'm steady…" })).toHaveValue("Pretend old answer, and more pretend words");
  });

  it("the note deleted on another device while she writes: the editor stays, and Save keeps it", async () => {
    await confirmedDevice(db, jk);
    const id = await saveNote(jk, TODAY, OTHER, { ...fields, thought: "Pretend old thought", steady: "Pretend old answer" });
    renderApp("/journal/notes", TODAY);
    const s = await section();
    await userEvent.click(await within(s).findByRole("button", { name: "Edit: Pretend old thought" }));
    const answer = within(s).getByRole("textbox", { name: "What I know when I'm steady…" });
    await userEvent.type(answer, " kept");
    await deleteNote(jk, OTHER, id, (await listNotes(jk)).notes[0]!.seen);
    expect(await within(s).findByText(DELETED_ELSEWHERE)).toBeInTheDocument();
    const form = within(s).getByRole("form", { name: "Your note" });
    expect(within(form).getByRole("textbox", { name: "What I know when I'm steady…" })).toHaveValue("Pretend old answer kept");
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await listNotes(jk)).notes).toEqual([expect.objectContaining({ steady: "Pretend old answer kept" })]));
  });
});

it("two devices' versions written apart: the newest shows, the other below as another version (review I1)", async () => {
  await confirmedDevice(db, jk);
  const id = await saveNote(jk, TODAY, OTHER, { ...fields, thought: "Pretend thought", steady: "Pretend first words" });
  const base = (await listNotes(jk)).notes[0]!.seen;
  await saveNote(jk, TODAY, "device-ipad-001", { ...fields, thought: "Pretend thought", steady: "Pretend iPad words" }, { id, seen: base });
  await saveNote(jk, TODAY, OTHER, { ...fields, thought: "Pretend thought", steady: "Pretend phone words" }, { id, seen: base });
  renderApp("/journal/notes", TODAY);
  const own = await within(await section()).findByRole("group", { name: "My own thoughts" });
  expect(await within(own).findByText("Pretend phone words")).toBeInTheDocument();
  expect(within(own).getByText(/^Another version \(from .+\)$/)).toBeInTheDocument();
  expect(within(own).getByText("Pretend iPad words")).toBeInTheDocument();
});

it("the tick shows this device's own: unticked here, it stays unticked (review M1)", async () => {
  await confirmedDevice(db, jk);
  const id = await saveNote(jk, TODAY, OTHER, { ...fields, thought: "Pretend thought", steady: "Pretend words" });
  await setNoteRead(jk, TODAY, OTHER, id, true); // ticked on the phone
  renderApp("/journal/notes", TODAY);
  const top = await within(await section()).findByRole("group", { name: "To read today" });
  const box = await within(top).findByRole("checkbox", { name: /^I read this today/ });
  expect(box).not.toBeChecked();
  await userEvent.click(box);
  await waitFor(() => expect(box).toBeChecked());
  await userEvent.click(box);
  await waitFor(async () => expect((await listNoteReads(jk)).ownOn(TODAY, await getDeviceId(db)).size).toBe(0));
  expect(box).not.toBeChecked();
});

it("a note can be edited, and deleted after a second tap", async () => {
  await confirmedDevice(db, jk);
  await saveNote(jk, TODAY, OTHER, { ...fields, thought: "Pretend old thought", steady: "Pretend old answer" });
  renderApp("/journal/notes", TODAY);
  const s = await section();
  const own = await within(s).findByRole("group", { name: "My own thoughts" });
  await userEvent.click(await within(own).findByRole("button", { name: "Edit: Pretend old thought" }));
  const form = within(s).getByRole("form", { name: "Your note" });
  const answer = within(form).getByRole("textbox", { name: "What I know when I'm steady…" });
  expect(answer).toHaveValue("Pretend old answer");
  await userEvent.clear(answer);
  await userEvent.type(answer, "Pretend new answer");
  await userEvent.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(within(s).queryByRole("form")).toBeNull());
  expect(await within(own).findByText("Pretend new answer")).toBeInTheDocument();
  expect((await listNotes(jk)).notes).toHaveLength(1);

  await userEvent.click(within(own).getByRole("button", { name: "Edit: Pretend old thought" }));
  await userEvent.click(within(s).getByRole("button", { name: "Delete" }));
  expect(within(s).getByText("Delete this note?")).toBeInTheDocument();
  await userEvent.click(within(s).getByRole("button", { name: "Delete it" }));
  await waitFor(async () => expect((await listNotes(jk)).notes).toHaveLength(0));
  await waitFor(() => expect(within(s).queryByText("Pretend new answer")).toBeNull());
});

it("no notes yet: no reread box at the top", async () => {
  await confirmedDevice(db, jk);
  renderApp("/journal/notes", TODAY);
  const s = await section();
  await within(s).findByRole("group", { name: "Why bother" });
  expect(within(s).queryByRole("group", { name: "To read today" })).toBeNull();
});

it("at the top, one or two of her notes to reread, with a gentle 'I read this today' tick (no streak, no count)", async () => {
  await confirmedDevice(db, jk);
  for (const w of ["one", "two", "three"]) await saveNote(jk, TODAY, OTHER, { ...fields, thought: `Pretend thought ${w}`, steady: `Pretend answer ${w}` });
  renderApp("/journal/notes", TODAY);
  const s = await section();
  const top = await within(s).findByRole("group", { name: "To read today" });
  const ticks = await within(top).findAllByRole("checkbox", { name: /^I read this today/ });
  expect(ticks).toHaveLength(2);
  expect(ticks[0]).toHaveClass("tick");
  expect(ticks[0]).not.toBeChecked();
  // It sits above the groups.
  const group = within(s).getByRole("group", { name: "Why bother" });
  expect(top.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await userEvent.click(ticks[0]!);
  await waitFor(() => expect(ticks[0]).toBeChecked());
  await waitFor(async () => expect((await listNoteReads(jk)).readOn(TODAY).size).toBe(1));
  expect(s.textContent).not.toMatch(/streak|in a row|missed/i);
  expect(s.querySelector(".streak")).toBeNull();
});

describe("Hard moment", () => {
  it("is on every Journal tab and opens her notes straight away in a calm full view", async () => {
    await confirmedDevice(db, jk);
    await saveNote(jk, TODAY, OTHER, { ...fields, prompt: "He's going to leave", thought: "He's going to leave", steady: "Pretend: he came back every time", memory: "Pretend memory of a pretend trip" });
    await saveNote(jk, TODAY, OTHER, { ...fields, thought: "Pretend own worry", steady: "Pretend own answer" });
    for (const path of ["/journal/exercise", "/journal/morning", "/journal/check-in", "/journal/read-back", "/journal/notes"]) {
      const view = renderApp(path, TODAY);
      expect(await screen.findByRole("button", { name: "Hard moment" })).toBeInTheDocument();
      view.unmount();
    }
    renderApp("/journal/morning", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Hard moment" }));
    const view = await screen.findByRole("dialog", { name: "Notes to myself" });
    expect(await within(view).findByText("Pretend: he came back every time")).toBeInTheDocument();
    expect(within(view).getByText("He's going to leave")).toBeInTheDocument();
    expect(within(view).getByText("Pretend memory of a pretend trip")).toBeInTheDocument();
    expect(within(view).getByText("Pretend own answer")).toBeInTheDocument();
    expect(within(view).queryByRole("checkbox")).toBeNull(); // nothing to do here, just read
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("with no notes yet, a kind line pointing to the tab", async () => {
    await confirmedDevice(db, jk);
    renderApp("/journal/exercise", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Hard moment" }));
    const view = await screen.findByRole("dialog", { name: "Notes to myself" });
    expect(await within(view).findByText(/You haven't written any notes yet/)).toBeInTheDocument();
  });
});
