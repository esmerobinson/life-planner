import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import {
  CANT_OPEN, cardRef, ensureCheckinSet, finishMorningPage, importExerciseCards, newNoteId, saveAnswer, saveNote, saveNoteDraft,
  submitExerciseEntry,
} from "../../data/repo";
import { journalAad, sealJson, type JournalKey } from "../../journal/crypto";
import { parseCardFile } from "../../journal/exercise";
import { getDeviceId } from "../../sync/engine";
import { FAKE_CARD_TEXT_V2 } from "../../test/exerciseCards";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { findReadBackTile, openReadBackPart } from "../../test/readBack";
import { currentUrl, renderApp } from "../../test/renderApp";
import { NOTHING_YET, READ_BACK_LINE } from "./ReadBack";

// Read back (2026-11-05, option B "Choose a part first"): four tiles, one per Journal part,
// each opening that part's whole list by month. Fictional cards and words only.

const PASS = "fake-journal-passphrase-for-tests";
const TODAY = "2026-11-05";
const SET = parseCardFile(FAKE_CARD_TEXT_V2)!;
const WEATHER = SET.cards[1]!; // "Day 1 · Pretend weather"
const OTHER = "device-phone-01";
const note = { prompt: null, memory: "", skill: "" };
let jk: JournalKey;
let other: JournalKey;
beforeAll(async () => {
  jk = await keyFor(PASS);
  other = await keyFor("fake-other-passphrase");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
  await confirmedDevice(db, jk);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const panel = () => screen.findByRole("region", { name: "Read back" }, { timeout: 5000 });
const tileNames = async () =>
  within(await panel())
    .getAllByRole("button")
    .map((b) => b.querySelector(".journal-readback-tile-name")?.textContent);

/** Something in every part: exercises over three months, check-ins, a ready and a locked page, notes. */
async function everything() {
  const me = await getDeviceId(db);
  await importExerciseCards(jk, SET, "2025-12-01");
  await submitExerciseEntry(jk, "2026-11-04", me, cardRef(WEATHER), "Pretend November weather");
  await submitExerciseEntry(jk, "2026-10-20", me, cardRef(WEATHER), "Pretend October weather");
  await submitExerciseEntry(jk, "2025-12-30", me, cardRef(WEATHER), "Pretend last December weather");
  await ensureCheckinSet(jk, "2026-11-03", ["K4", "K2"]);
  await saveAnswer(jk, "2026-11-03", "K4", OTHER, "Pretend answer one", true);
  await saveAnswer(jk, "2026-11-03", "K2", OTHER, "Pretend answer two", true);
  await ensureCheckinSet(jk, "2026-10-27", ["K4"]);
  await saveAnswer(jk, "2026-10-27", "K4", OTHER, "Pretend October answer", true);
  await finishMorningPage(jk, "2026-10-01", OTHER, "Pretend old page words");
  await finishMorningPage(jk, "2026-11-02", OTHER, "Pretend new page words");
  await saveNote(jk, "2026-11-01", OTHER, { ...note, thought: "Pretend November thought", steady: "Pretend steady November words" });
  await saveNote(jk, "2026-10-15", OTHER, { ...note, thought: "Pretend October thought", steady: "Pretend steady October words", skill: "Pretend skill" });
}

it("opens on four tiles in the Journal's tab order, each with its count and last day", async () => {
  await everything();
  renderApp("/journal/read-back", TODAY);
  expect(await within(await panel()).findByText(READ_BACK_LINE)).toBeInTheDocument();
  expect(await tileNames()).toEqual(["Mental health exercise", "Morning pages", "Daily check-in", "Notes to myself"]);
  expect(await findReadBackTile("Mental health exercise")).toHaveTextContent(/^Mental health exercise3Last: Wednesday 4 November$/);
  expect(await findReadBackTile("Morning pages")).toHaveTextContent(/^Morning pages21 ready to read · 1 opening later$/);
  expect(await findReadBackTile("Daily check-in")).toHaveTextContent(/^Daily check-in2Last: Tuesday 3 November$/);
  expect(await findReadBackTile("Notes to myself")).toHaveTextContent(/^Notes to myself2Last: Sunday 1 November$/);
  // Nothing anyone wrote shows on the tiles.
  expect(document.body.innerHTML).not.toContain("Pretend");
});

it("empty: every tile says 0 and Nothing yet; an empty part says so", async () => {
  renderApp("/journal/read-back", TODAY);
  for (const name of ["Mental health exercise", "Morning pages", "Daily check-in", "Notes to myself"] as const) {
    expect(await findReadBackTile(name)).toHaveTextContent(new RegExp(`^${name}0Nothing yet$`));
  }
  const part = await openReadBackPart("Notes to myself");
  expect(within(part).getByText(NOTHING_YET)).toBeInTheDocument();
  expect(within(part).queryByRole("list")).toBeNull();
});

it("a part opens in place of the tiles: its name, then its entries by month, newest first", async () => {
  await everything();
  renderApp("/journal/read-back", TODAY);
  const part = await openReadBackPart("Mental health exercise");
  expect(currentUrl).toBe("/journal/read-back?part=exercise");
  expect(within(await panel()).queryByRole("button", { name: /^Daily check-in/ })).toBeNull();
  expect(within(part).getByRole("heading", { level: 3, name: "Mental health exercise" })).toBeInTheDocument();
  expect(within(part).getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["November", "October", "December 2025"]);
  const months = within(part).getAllByRole("list");
  expect(months.map((l) => l.getAttribute("aria-label"))).toEqual(["November", "October", "December 2025"]);
  const summaries = (l: HTMLElement) => [...l.querySelectorAll(":scope > li > details > summary")].map((s) => s.textContent);
  expect(months.map(summaries)).toEqual([
    ["Wednesday 4 November · Day 1 · Pretend weather"],
    ["Tuesday 20 October · Day 1 · Pretend weather"],
    ["Tuesday 30 December · Day 1 · Pretend weather"],
  ]);
  await userEvent.click(within(months[2]!).getByText("Tuesday 30 December · Day 1 · Pretend weather"));
  expect(within(months[2]!).getByText("Pretend last December weather")).toBeVisible();
});

it("check-ins: the date and how many answers; each opens to exactly what she wrote", async () => {
  await everything();
  renderApp("/journal/read-back", TODAY);
  const part = await openReadBackPart("Daily check-in");
  await userEvent.click(within(part).getByText("Tuesday 3 November · 2 answers"));
  expect(within(part).getByText("Pretend answer one")).toBeVisible();
  expect(within(part).getByText("Pretend answer two")).toBeVisible();
  expect(within(part).getByText("Tuesday 27 October · 1 answer")).toBeInTheDocument();
});

it("morning pages: a page past its 4 weeks opens; a newer one shows only when it opens", async () => {
  await everything();
  renderApp("/journal/read-back", TODAY);
  const part = await openReadBackPart("Morning pages");
  expect(within(part).getByText("Opens on Monday 30 November")).toBeInTheDocument();
  expect(document.body.innerHTML).not.toContain("Pretend new page words");
  await userEvent.click(within(part).getByText("Thursday 1 October"));
  expect(await within(part).findByText("Pretend old page words")).toBeInTheDocument();
  expect(document.body.innerHTML).not.toContain("Pretend new page words");
});

it("← Read back goes back to the tiles (and to the tile she came from)", async () => {
  await everything();
  renderApp("/journal/read-back", TODAY);
  const part = await openReadBackPart("Daily check-in");
  expect(within(part).getByRole("heading", { name: "Daily check-in" })).toHaveFocus();
  await userEvent.click(within(part).getByRole("link", { name: "← Read back" }));
  const tile = await findReadBackTile("Daily check-in");
  expect(currentUrl).toBe("/journal/read-back");
  expect(tile).toHaveFocus();
  expect(screen.queryByRole("region", { name: "Daily check-in" })).toBeNull();
  // The Read back tab itself also shows the tiles again.
  await openReadBackPart("Notes to myself");
  await userEvent.click(screen.getByRole("link", { name: "Read back" }));
  expect(await findReadBackTile("Notes to myself")).toBeInTheDocument();
});

it("Notes to myself: every saved note by month, newest first, read-only, with its other versions; no drafts", async () => {
  await everything();
  const me = await getDeviceId(db);
  // Another version of the November note, written on another device without seeing this one.
  const { listNotes } = await import("../../data/repo");
  const nov = (await listNotes(jk)).notes.find((n) => n.thought === "Pretend November thought")!;
  await saveNote(jk, "2026-11-01", "device-ipad-001", { ...note, thought: "Pretend November thought", steady: "Pretend iPad words" }, { id: nov.id, seen: [] });
  // A note she's still writing here (a draft) isn't shown.
  await saveNoteDraft(jk, me, newNoteId(TODAY), { ...note, thought: "Pretend draft thought", steady: "Pretend draft words" }, []);
  const before = await db.journal.toArray();

  renderApp("/journal/read-back", TODAY);
  const part = await openReadBackPart("Notes to myself");
  const months = within(part).getAllByRole("list");
  expect(months.map((l) => l.getAttribute("aria-label"))).toEqual(["November", "October"]);
  expect(within(months[0]!).getByText(/^Sunday 1 November · Pretend November thought$/)).toBeInTheDocument();
  await userEvent.click(within(months[1]!).getByText("Thursday 15 October · Pretend October thought"));
  expect(within(months[1]!).getByText("Pretend steady October words")).toBeVisible();
  expect(within(months[1]!).getByText("Pretend skill")).toBeVisible();
  await userEvent.click(within(months[0]!).getByText("Sunday 1 November · Pretend November thought"));
  const open = within(months[0]!).getByText("Sunday 1 November · Pretend November thought").closest("details")!;
  // Both versions' words are there (whichever is newest shows first).
  expect(within(open).getByText(/Another version \(from/)).toBeVisible();
  expect(within(open).getByText("Pretend steady November words")).toBeVisible();
  expect(within(open).getByText("Pretend iPad words")).toBeVisible();
  // Read-only: nothing to edit, delete or type into, and nothing was written.
  expect(within(part).queryByRole("button")).toBeNull();
  expect(within(part).queryByRole("textbox")).toBeNull();
  expect(screen.queryByText(/Pretend draft/)).toBeNull();
  await new Promise((r) => setTimeout(r, 200));
  const after = await db.journal.toArray();
  const ids = (rows: { id: string; ct?: unknown }[]) => rows.map((r) => r.id).sort();
  expect(ids(after)).toEqual(ids(before));
});

it("a note, check-in or exercise that won't open here says so, on the tiles and in its part", async () => {
  await everything();
  const id = "note:2026-11-02:pretendunreadable_device-x_v1";
  await db.journal.put({ id, kind: "note", date: "2026-11-02", fp: other.fp, ...(await sealJson(other.key, { v: 1, thought: "x" }, journalAad(id))) });
  renderApp("/journal/read-back", TODAY);
  expect(await within(await panel()).findByText(CANT_OPEN)).toBeInTheDocument();
  const part = await openReadBackPart("Notes to myself");
  expect(within(part).getByText(CANT_OPEN)).toBeInTheDocument();
  // The readable notes are all still there.
  expect(within(part).getAllByRole("listitem")).toHaveLength(2);
});

it("an unknown part opens the tiles", async () => {
  await everything();
  renderApp("/journal/read-back?part=pretend", TODAY);
  expect(await findReadBackTile("Mental health exercise")).toBeInTheDocument();
});

it("See all under Past check-ins opens Read back straight on Daily check-in, with every day", async () => {
  const me = await getDeviceId(db);
  for (const d of ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", TODAY]) {
    await ensureCheckinSet(jk, d, ["M1"]);
    await saveAnswer(jk, d, "M1", me, `Pretend answer on ${d}`, true);
  }
  renderApp("/journal/check-in", TODAY);
  await userEvent.click(await screen.findByText("Past check-ins", {}, { timeout: 5000 }));
  await userEvent.click(screen.getByRole("link", { name: "See all" }));
  const part = await within(await panel()).findByRole("region", { name: "Daily check-in" }, { timeout: 5000 });
  expect(currentUrl).toBe("/journal/read-back?part=check-in");
  await waitFor(() => expect(part.querySelectorAll(".journal-readback-list > li")).toHaveLength(5));
  expect(within(part).getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["November", "October"]);
});
