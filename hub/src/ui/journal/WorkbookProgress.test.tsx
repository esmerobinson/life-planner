import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import { importExerciseCards, saveExerciseMark } from "../../data/repo";
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
  const bpd = await within(s).findByRole("button", { name: "BPD workbook · Day 2 of 4 · Chapter 1 of 2" });
  const dbt = within(s).getByRole("button", { name: "DBT skills · Card 2 of 3 · Chapter 2 of 2" });
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
  expect(await within(s).findByRole("button", { name: /^BPD workbook · Day 1 of 4/ })).toBeInTheDocument();
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
  const rows = within(map).getAllByRole("listitem");
  expect(rows.map((r) => r.querySelector(".wb-ch-title")?.textContent)).toEqual(["1 · Pretend hilltop", "2 · Pretend valley"]);
  expect(rows.map((r) => r.querySelector(".wb-ch-n")?.textContent)).toEqual(["1 / 1", "0 / 2"]);
  const dots = within(rows[1]!).getAllByRole("button");
  expect(dots.map((d) => d.getAttribute("aria-label"))).toEqual([
    "Card 2 · Pretend second-book two · up next", "Card 3 · Pretend second-book three",
  ]);
  expect(dots[0]).toHaveClass("wb-dot", "now");
  expect(within(rows[0]!).getByRole("button")).toHaveClass("wb-dot", "on");
  // The other book.
  await userEvent.click(within(map).getByRole("button", { name: "BPD" }));
  expect(within(map).getAllByRole("listitem").map((r) => r.querySelector(".wb-ch-n")?.textContent)).toEqual(["1 / 2", "0 / 2"]);
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

it("tapping a done card's dot opens what she wrote; a dot not done opens the card to read", async () => {
  await confirmedDevice(db, jk);
  await importExerciseCards(jk, BOOKS, "2026-10-01");
  await someDone();
  renderApp("/journal/exercise", TODAY);
  const s = await section();
  await userEvent.click(await within(s).findByRole("button", { name: /^BPD workbook/ }));
  let map = await screen.findByRole("dialog", { name: "Your workbooks" });
  await userEvent.click(within(map).getByRole("button", { name: "Day 1 · Pretend first-book one · done" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  const all = within(s).getByText("All cards", { selector: "summary" }).closest("details")!;
  await waitFor(() => expect(all).toHaveAttribute("open"));
  const opened = await waitFor(() => {
    const d = [...all.querySelectorAll("details")].find((x) => x.open);
    expect(d).toBeTruthy();
    return d!;
  });
  expect(within(opened).getByText("Day 1 · Pretend first-book one")).toBeInTheDocument();

  await userEvent.click(within(s).getByRole("button", { name: "Chapter map" }));
  map = await screen.findByRole("dialog", { name: "Your workbooks" });
  await userEvent.click(within(map).getByRole("button", { name: "Day 4 · Pretend first-book four" }));
  await waitFor(() => expect([...all.querySelectorAll("details")].find((x) => x.open && x.textContent?.includes("Pretend first-book four"))).toBeTruthy());
});
