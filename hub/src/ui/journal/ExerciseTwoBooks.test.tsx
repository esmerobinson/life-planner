import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import { cardRef, importExerciseCards, listExerciseEntries, saveExerciseMark, submitExerciseEntry, type PartAnswer } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { checkCardFile } from "../../journal/exercise";
import { getDeviceId } from "../../sync/engine";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { openAllChapters } from "../../test/chapterMap";
import { renderApp } from "../../test/renderApp";
import { openReadBackPart } from "../../test/readBack";

// Esme, 2026-11-04: two books taken in turn, each numbered from Day 1. Her answer to the second
// book's Day 1 ("What coping costs") couldn't be found among entries labelled only "Day 1 · …",
// and two entries showed as the first book's Day 1. Every entry is its own card (by full id),
// labelled with its book and title. Fictional books, cards and words only.

const PASS = "fake-journal-passphrase-for-tests";
const TODAY = "2026-11-04";
const card = (id: string, track: string, theme: string, extra: Record<string, unknown> = {}) => ({
  id, day: 1, chapter: 1, chapterTitle: "Pretend chapter", optional: false, theme, track,
  learn: `A made-up note for ${theme}.`, try: `A made-up thing to try for ${theme}.`, book: "", skill: "", session: false, ...extra,
});
const PARTS = [
  { prompt: "Pretend: which costs fit?", kind: "checklist", items: ["Pretend cost one", "Pretend cost two"], options: ["Yes", "No"], note: "" },
  { prompt: "Pretend: what did it cost you?", kind: "text" },
  { prompt: "Pretend: what would you rather do?", kind: "text" },
];
const SET = checkCardFile({
  app: "esmeworld", kind: "exercise-cards", version: 2, source: "Two pretend books (test fixture)",
  tracks: [{ id: "bpd", title: "Pretend BPD book" }, { id: "dbt", title: "Pretend DBT book" }],
  cards: [
    card("ch01-001", "bpd", "Pretend naming"),
    card("ch01-002", "bpd", "Pretend second naming", { day: 2 }),
    card("dbt-ch01-001", "dbt", "Pretend costs", { parts: PARTS }),
    card("dbt-ch01-002", "dbt", "Pretend second costs", { day: 2 }),
  ],
})!;
const BPD1 = SET.cards[0]!;
const DBT1 = SET.cards[2]!;
const BPD_WORDS = "Pretend: naming a made-up feeling, a long paragraph about it.";
const DBT_ANSWER: PartAnswer[] = [
  { prompt: PARTS[0]!.prompt, kind: "checklist", answer: [["Pretend cost one", "Yes", ""], ["Pretend cost two", "No", ""]] },
  { prompt: PARTS[1]!.prompt, kind: "text", answer: "Pretend: it cost me a whole made-up afternoon, and then some more." },
  { prompt: PARTS[2]!.prompt, kind: "text", answer: "Pretend: go for a walk by the made-up river instead." },
];
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor(PASS);
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
  await confirmedDevice(db, jk);
  expect(SET).toBeTruthy();
  await importExerciseCards(jk, SET, "2026-10-01");
  const device = await getDeviceId(db);
  // Old (version 1) cards: the first book's Day 1, stored by day and theme only.
  await submitExerciseEntry(jk, "2026-11-02", device, { id: "day-1", day: 1, theme: "Pretend naming", legacy: true }, "Pretend: from the old cards.");
  await submitExerciseEntry(jk, "2026-11-03", device, cardRef(BPD1), BPD_WORDS);
  await saveExerciseMark(jk, "2026-11-03", device, BPD1.id, true);
  await submitExerciseEntry(jk, TODAY, device, cardRef(DBT1), DBT_ANSWER);
});
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 150));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("the store keeps them apart: three entries, each its own card", async () => {
  const { entries } = await listExerciseEntries(jk, "2026-11-05");
  expect(entries.map((e) => [e.date, e.id, e.theme])).toEqual([
    [TODAY, "dbt-ch01-001", "Pretend costs"],
    ["2026-11-03", "ch01-001", "Pretend naming"],
    ["2026-11-02", "day-1", "Pretend naming"],
  ]);
});

it("Read back: the date first, then the book and the card's title; each opens to its own full answer", async () => {
  renderApp("/journal/read-back", TODAY);
  const list = await openReadBackPart("Mental health exercise");
  // Every exercise in Read back's Mental health exercise part, newest first (each entry's own summary).
  const summaries = [...list.querySelectorAll(".journal-readback-list > li > details > summary")].map((s) => s.textContent);
  expect(summaries).toEqual([
    "Wednesday 4 November · Pretend DBT book · Day 1 · Pretend costs",
    "Tuesday 3 November · Pretend BPD book · Day 1 · Pretend naming",
    "Monday 2 November · Earlier card (day 1) · Pretend naming",
  ]);
  await userEvent.click(within(list).getByText(/Pretend DBT book · Day 1 · Pretend costs/));
  expect(within(list).getByText("Pretend: it cost me a whole made-up afternoon, and then some more.")).toBeInTheDocument();
  expect(within(list).getByText("Pretend: go for a walk by the made-up river instead.")).toBeInTheDocument();
  expect(within(list).getByText("Pretend cost one: Yes")).toBeInTheDocument();
});

it("Past exercises and the chapter map: each entry under its own book and title, with its own words", async () => {
  renderApp("/journal/exercise", TODAY);
  const s = await screen.findByRole("region", { name: "Mental health exercise" });
  // Today's card is done, so the next one is on the tab (never a finished card).
  await within(s).findByRole("article", {}, { timeout: 5000 });
  await userEvent.click(within(s).getByText("Past exercises"));
  const past = within(s).getByRole("list", { name: "Past exercises" });
  expect(within(past).getAllByRole("listitem").map((li) => li.querySelector("summary")!.textContent)).toEqual([
    "Wednesday 4 November · Pretend DBT book · Day 1 · Pretend costs",
    "Tuesday 3 November · Pretend BPD book · Day 1 · Pretend naming",
    "Monday 2 November · Earlier card (day 1) · Pretend naming",
  ]);
  await userEvent.click(within(past).getByText(/Pretend DBT book · Day 1 · Pretend costs/));
  expect(within(past).getByText("Pretend: it cost me a whole made-up afternoon, and then some more.")).toBeInTheDocument();

  // The chapter map: each book its own tab, each card its own responses.
  const map = await openAllChapters(s);
  await userEvent.click(within(map).getByRole("button", { name: "DBT" }));
  for (const t of within(map).queryAllByRole("button", { expanded: false })) await userEvent.click(t);
  await userEvent.click([...map.querySelectorAll<HTMLButtonElement>("button.wb-card-link")].find((b) => b.textContent?.includes("Pretend costs"))!);
  const mine = within(map).getByRole("list", { name: "Your responses" });
  expect(within(mine).getByText("Pretend: go for a walk by the made-up river instead.")).toBeInTheDocument();
  expect(within(mine).queryByText(BPD_WORDS)).toBeNull();
  await userEvent.click(within(map).getByRole("button", { name: "← All chapters" }));
  await userEvent.click(within(map).getByRole("button", { name: "BPD" }));
  for (const t of within(map).queryAllByRole("button", { expanded: false })) await userEvent.click(t);
  await userEvent.click([...map.querySelectorAll<HTMLButtonElement>("button.wb-card-link")].find((b) => b.textContent?.includes("Pretend naming"))!);
  const theirs = within(map).getByRole("list", { name: "Your responses" });
  expect(within(theirs).getByText(BPD_WORDS)).toBeInTheDocument();
  expect(within(theirs).queryByText(/whole made-up afternoon/)).toBeNull();
});
