import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import { cardRef, importExerciseCards, saveExerciseMark, submitExerciseEntry } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { checkCardFile } from "../../journal/exercise";
import { getDeviceId } from "../../sync/engine";
import { FAKE_CARD_FILE_BOOKS } from "../../test/exerciseCards";
import { confirmedDevice, keyFor, verifierRow } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";

// The workbook bars (2A) and the chapter map pop-up (2C) at the top of the Mental health
// exercise tab (journal v3). Fictional cards only.

const PASS = "fake-journal-passphrase-for-tests";
const TODAY = "2026-11-04";
const BOOKS = checkCardFile(FAKE_CARD_FILE_BOOKS)!;
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor(PASS);
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear()]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const section = () => screen.findByRole("region", { name: "Mental health exercise" });

/** The first book's Day 1 and the second's Card 1 done on earlier days. */
async function someDone() {
  const me = await getDeviceId(db);
  await saveExerciseMark(jk, "2026-11-02", me, "b-001", true);
  await saveExerciseMark(jk, "2026-11-03", me, "d-001", true);
}

it("locked: no bars", async () => {
  await db.journal.put(await verifierRow(jk));
  renderApp("/journal/exercise", TODAY);
  expect(await screen.findByRole("heading", { name: "Unlock journal" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /BPD workbook/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Chapter map" })).toBeNull();
});

it("two slim bars at the top of the tab, worked out from the cards and progress", async () => {
  await confirmedDevice(db, jk);
  await importExerciseCards(jk, BOOKS, "2026-10-01");
  await someDone();
  renderApp("/journal/exercise", TODAY);
  const s = await section();
  // Cards done and to go (Esme, 2026-11-09: "64 cards done · 87 to go", not "Day N of 151").
  const bpd = await within(s).findByRole("button", { name: "BPD workbook · 1 card done · 3 to go · Chapter 1 of 2" });
  const dbt = within(s).getByRole("button", { name: "DBT skills · 1 card done · 2 to go · Chapter 2 of 2" });
  expect(within(bpd).getByText("1 card done · 3 to go")).toHaveClass("nowrap");
  expect(within(s).queryByText(/Day \d+ of|Card \d+ of/)).toBeNull();
  expect(within(bpd).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
  expect(within(dbt).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "33");
  expect(bpd.closest(".wb-bars")).not.toBeNull();
  // Above the Update cards pill and today's card.
  const update = within(s).getByRole("button", { name: "Update cards" });
  expect(bpd.compareDocumentPosition(update) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(s).getByRole("button", { name: "Chapter map" })).toHaveClass("quiet-link");
});

it("a book with no cards has no bar", async () => {
  await confirmedDevice(db, jk);
  const onlyFirst = checkCardFile({ ...FAKE_CARD_FILE_BOOKS, cards: FAKE_CARD_FILE_BOOKS.cards.filter((c) => c.id.startsWith("b-")) })!;
  await importExerciseCards(jk, onlyFirst, "2026-10-01");
  renderApp("/journal/exercise", TODAY);
  const s = await section();
  expect(await within(s).findByRole("button", { name: /^BPD workbook · 0 cards done · 4 to go/ })).toBeInTheDocument();
  expect(within(s).queryByRole("button", { name: /DBT skills/ })).toBeNull();
});

it("tapping a bar opens the chapter map on that book: a row per chapter, done/total, a dot per card", async () => {
  await confirmedDevice(db, jk);
  await importExerciseCards(jk, BOOKS, "2026-10-01");
  await someDone();
  renderApp("/journal/exercise", TODAY);
  const s = await section();
  await userEvent.click(await within(s).findByRole("button", { name: /^DBT skills/ }));
  const map = await screen.findByRole("dialog", { name: "Your workbooks" });
  expect(within(map).getByRole("button", { name: "DBT" })).toHaveAttribute("aria-pressed", "true");
  expect(within(map).getByRole("button", { name: "BPD" })).toHaveAttribute("aria-pressed", "false");
  // The book's summary bar in the map says cards too.
  expect(map.querySelector(".wb-summary-label b")?.textContent).toBe("1 card done · 2 to go");
  const chapters = () => within(within(map).getByRole("list", { name: /chapters$/ })).getAllByRole("listitem");
  const rows = chapters();
  expect(rows.map((r) => r.querySelector(".wb-ch-title")?.textContent)).toEqual(["1 · Pretend hilltop", "2 · Pretend valley"]);
  expect(rows.map((r) => r.querySelector(".wb-ch-n")?.textContent)).toEqual(["1 / 1", "0 / 2"]);
  const dots = [...rows[1]!.querySelectorAll("button.wb-dot")];
  expect(dots.map((d) => d.getAttribute("aria-label"))).toEqual([
    "Card 2 · Pretend second-book two · up next", "Card 3 · Pretend second-book three",
  ]);
  expect(dots[0]).toHaveClass("wb-dot", "now");
  expect(rows[0]!.querySelector("button.wb-dot")).toHaveClass("wb-dot", "on");
  // The other book (with its optional reading first).
  await userEvent.click(within(map).getByRole("button", { name: "BPD" }));
  expect(chapters().map((r) => r.querySelector(".wb-ch-n")?.textContent)).toEqual(["1 / 2", "0 / 2"]);
  expect(within(within(map).getByRole("list", { name: "Optional reading" })).getByRole("button", { name: "Pretend introduction (optional reading)" })).toBeInTheDocument();
  // Done closes it; focus goes back.
  await userEvent.click(within(map).getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("Chapter map opens it too; Escape closes it", async () => {
  await confirmedDevice(db, jk);
  await importExerciseCards(jk, BOOKS, "2026-10-01");
  renderApp("/journal/exercise", TODAY);
  const s = await section();
  await userEvent.click(await within(s).findByRole("button", { name: "Chapter map" }));
  const map = await screen.findByRole("dialog", { name: "Your workbooks" });
  expect(within(map).getByRole("button", { name: "BPD" })).toHaveAttribute("aria-pressed", "true");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("a chapter opens to its cards; a card opens in the pop-up (what she wrote if done), with a way back", async () => {
  await confirmedDevice(db, jk);
  await importExerciseCards(jk, BOOKS, "2026-10-01");
  const me = await getDeviceId(db);
  await submitExerciseEntry(jk, "2026-11-02", me, cardRef(BOOKS.cards.find((c) => c.id === "b-001")!), "Pretend meadow answer");
  renderApp("/journal/exercise", TODAY);
  const s = await section();
  await userEvent.click(await within(s).findByRole("button", { name: "See all chapters" }));
  const map = await screen.findByRole("dialog", { name: "Your workbooks" });
  const toggle = within(map).getByRole("button", { name: "1 · Pretend meadow" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(within(map).queryByRole("list", { name: "Chapter 1 cards" })).toBeNull();
  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  const cards = within(within(map).getByRole("list", { name: "Chapter 1 cards" })).getAllByRole("button");
  expect(cards.map((c) => c.textContent)).toEqual(["Day 1 · Pretend first-book one ✓", "Day 2 · Pretend first-book two"]);
  await userEvent.click(cards[0]!);
  expect(within(map).getByText("Pretend first-book one")).toBeInTheDocument();
  expect(within(within(map).getByRole("list", { name: "Your responses" })).getByText("Pretend meadow answer")).toBeInTheDocument();
  await userEvent.click(within(map).getByRole("button", { name: "← All chapters" }));
  // A dot not done opens the card to read.
  await userEvent.click(within(map).getByRole("button", { name: "Day 4 · Pretend first-book four" }));
  expect(within(map).getByText("A made-up note for Pretend first-book four.")).toBeInTheDocument();
  expect(within(map).queryByRole("list", { name: "Your responses" })).toBeNull();
});

it("See what you wrote (after a Submit) opens that card's review in the pop-up", async () => {
  await confirmedDevice(db, jk);
  await importExerciseCards(jk, BOOKS, "2026-10-01");
  renderApp("/journal/exercise", TODAY);
  const s = await section();
  const today = await within(s).findByRole("article", { name: "Today's card" });
  await userEvent.type(await within(today).findByRole("textbox", { name: "Your response" }), "Pretend first answer");
  await userEvent.click(within(today).getByRole("button", { name: "Submit" }));
  await userEvent.click(await within(s).findByRole("button", { name: "See what you wrote" }));
  const map = await screen.findByRole("dialog", { name: "Your workbooks" });
  expect(within(within(map).getByRole("list", { name: "Your responses" })).getByText("Pretend first answer")).toBeInTheDocument();
});
