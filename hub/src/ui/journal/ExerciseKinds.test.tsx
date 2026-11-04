import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import {
  cardRef, importExerciseCards, logExerciseEntry, readExerciseEntry, readExerciseProgress, saveExerciseMark, submitExerciseEntry,
} from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { checkCardFile } from "../../journal/exercise";
import { getDeviceId } from "../../sync/engine";
import { FAKE_CARD_FILE_KINDS, FAKE_CARD_FILE_TRACKS } from "../../test/exerciseCards";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";
import { cardLines, openAllChapters } from "../../test/chapterMap";
import { SAVE_TODAY } from "./ExerciseResponseBox";

// The exercise tab with two books (tracks) and with the newer part kinds (table, scale,
// tracker, chain). Fictional cards and words only.

const PASS = "fake-journal-passphrase-for-tests";
const TODAY = "2026-11-02";
const TRACKS = checkCardFile(FAKE_CARD_FILE_TRACKS)!;
const KINDS = checkCardFile(FAKE_CARD_FILE_KINDS)!;
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor(PASS);
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
  await confirmedDevice(db, jk);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const section = () => screen.findByRole("region", { name: "Mental health exercise" });
const todayCard = async () => within(await section()).findByRole("article", { name: "Today's card" });
/** Make the card with this id today's (the ones before it done on earlier days). */
async function todayIs(id: string) {
  const device = await getDeviceId(db);
  const ids = KINDS.cards.map((c) => c.id);
  for (const [i, x] of ids.slice(0, ids.indexOf(id)).entries()) await saveExerciseMark(jk, `2026-10-2${i}`, device, x, true);
}

describe("two books", () => {
  beforeEach(() => importExerciseCards(jk, TRACKS, "2026-10-01"));

  it("the card shows its book with the chapter; Do the next one takes the other book", async () => {
    renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    expect(await within(card).findByText("Pretend first one")).toBeInTheDocument();
    expect(within(card).getByText("Pretend first workbook · Chapter 1 · Pretend chapter")).toBeInTheDocument();
    await userEvent.click(await within(card).findByRole("button", { name: "Do the next one →" }));
    const next = within(await section()).getByRole("article", { name: "Next card: Day 1" });
    expect(within(next).getByText("Pretend second one")).toBeInTheDocument();
    expect(within(next).getByText("Pretend second workbook · Chapter 1 · Pretend chapter")).toBeInTheDocument();
  });

  it("See all chapters: a pill per book, then its chapters and their cards", async () => {
    renderApp("/journal/exercise", TODAY);
    const s = await section();
    await todayCard();
    const map = await openAllChapters(s);
    expect(within(map).getAllByRole("button", { pressed: true }).concat(within(map).getAllByRole("button", { pressed: false })).map((b) => b.textContent))
      .toEqual(["Pretend first workbook", "Pretend second workbook"]);
    const titles = () => [...map.querySelectorAll(".wb-ch-title")].map((t) => t.textContent);
    expect(titles()).toEqual(["1 · Pretend chapter", "2 · Pretend later chapter"]);
    expect(cardLines(map)).toEqual(["Day 1 · Pretend first one", "Day 2 · Pretend first two", "Day 3 · Pretend first three"]);
    await userEvent.click(within(map).getByRole("button", { name: "Pretend second workbook" }));
    expect(titles()).toEqual(["1 · Pretend chapter"]);
    for (const t of within(map).queryAllByRole("button", { expanded: false })) await userEvent.click(t);
    expect(cardLines(map)).toEqual(["Day 1 · Pretend second one", "Day 2 · Pretend second two"]);
  });

  it("Read back shows the book", async () => {
    await submitExerciseEntry(jk, "2026-11-01", await getDeviceId(db), cardRef(TRACKS.cards[3]!), "Pretend second-book words");
    renderApp("/journal/read-back", TODAY);
    const list = await screen.findByRole("list", { name: "Read back" }, { timeout: 5000 });
    expect(within(list).getByText("Sunday 1 November · Exercise · Pretend second workbook · Day 1 · Pretend second one")).toBeInTheDocument();
  });
});

describe("newer part kinds", () => {
  beforeEach(() => importExerciseCards(jk, KINDS, "2026-10-01"));

  it("a table: a grid under its headings; Submit once every cell is in; the format chip", async () => {
    renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    expect(await within(card).findByText("Table")).toHaveClass("chip", "exercise-format");
    const table = await within(card).findByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Feeling", "Set off by"]);
    const submit = await within(card).findByRole("button", { name: "Submit" });
    for (const [label, w] of [["Feeling, row 1", "Pretend calm"], ["Set off by, row 1", "Pretend tea"], ["Feeling, row 2", "Pretend fizz"]]) {
      await userEvent.type(within(card).getByRole("textbox", { name: label }), w!);
    }
    expect(submit).toBeDisabled();
    await userEvent.type(within(card).getByRole("textbox", { name: "Set off by, row 2" }), "Pretend news");
    await userEvent.click(submit);
    // Submit replaces the card with the next one: wait for the saved answer, not the old card's "Saved".
    await waitFor(
      async () =>
        expect((await readExerciseEntry(jk, TODAY, cardRef(KINDS.cards[0]!))).entry).toMatchObject({
          saved: true, parts: [expect.objectContaining({ answer: [["Pretend calm", "Pretend tea"], ["Pretend fizz", "Pretend news"]] })],
        }),
      { timeout: 5000 },
    );
  });

  it("a scale: its points between the end labels; a value is needed", async () => {
    await todayIs("kinds-scale");
    renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    const group = await within(card).findByRole("group", { name: "How pretend-calm are you?" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["1", "2", "3", "4", "5"]);
    expect(within(group).getByText("Not at all")).toBeInTheDocument();
    expect(within(group).getByText("Very")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Submit" })).toBeDisabled();
    await userEvent.click(within(group).getByRole("button", { name: "4" }));
    expect(within(card).getByRole("button", { name: "Submit" })).toBeEnabled();
  });

  it("a tracker: day by day ('Day 1 of 3', today's day outlined); Save today's entry counts the day; it comes back with what was saved", async () => {
    await todayIs("kinds-tracker");
    const first = renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    expect(await within(card).findByText("Day 1 of 3")).toBeInTheDocument();
    const days = card.querySelectorAll(".exercise-tracker-day");
    expect(days).toHaveLength(3);
    expect(days[0]).toHaveClass("is-now");
    expect(within(card).queryByRole("button", { name: "Submit" })).toBeNull();
    const save = within(card).getByRole("button", { name: SAVE_TODAY });
    expect(save).toBeDisabled();
    await userEvent.type(within(card).getByRole("textbox", { name: "Day 1, Hours" }), "7");
    await userEvent.type(within(card).getByRole("textbox", { name: "Day 1, Mood" }), "Pretend fine");
    await userEvent.click(save);
    // Waits on what is stored (the day logged and its answer saved), not on a line in the card.
    await waitFor(
      async () =>
        expect((await readExerciseProgress(jk)).marks.find((m) => m.date === TODAY && m.logged)).toMatchObject({ id: "kinds-tracker" }),
      { timeout: 5000 },
    );
    await waitFor(async () => expect((await readExerciseEntry(jk, TODAY, cardRef(KINDS.cards[2]!))).entry?.saved).toBe(true), { timeout: 5000 });
    expect(await within(card).findByText("Saved", {}, { timeout: 5000 })).toBeInTheDocument();
    expect((await readExerciseProgress(jk)).marks.find((m) => m.date === TODAY)).toMatchObject({ id: "kinds-tracker", done: false });
    first.unmount();
    vi.useRealTimers();
    // The next day: the same card, Day 2 of 3, with Day 1 brought forward.
    renderApp("/journal/exercise", "2026-11-03");
    const again = await todayCard();
    expect(await within(again).findByText("Day 2 of 3")).toBeInTheDocument();
    expect(within(again).getByRole("textbox", { name: "Day 1, Hours" })).toHaveValue("7");
    expect(again.querySelectorAll(".exercise-tracker-day")[1]).toHaveClass("is-now");
    // Carried forward, nothing new: it can't be saved for today (review I2) …
    expect(within(again).getByRole("button", { name: SAVE_TODAY })).toBeDisabled();
    // … until today's day has something in it.
    await userEvent.type(within(again).getByRole("textbox", { name: "Day 2, Hours" }), "8");
    expect(within(again).getByRole("button", { name: SAVE_TODAY })).toBeEnabled();
  });

  it("a tracker logged on an earlier day is today's card again", async () => {
    await todayIs("kinds-tracker");
    const device = await getDeviceId(db);
    await logExerciseEntry(jk, "2026-11-01", device, cardRef(KINDS.cards[2]!), [{ prompt: "Pretend sleep log", kind: "tracker", answer: [["7", "ok"], ["", ""], ["", ""]] }]);
    renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    expect(await within(card).findByText("Pretend tracker")).toBeInTheDocument();
    expect(await within(card).findByText("Day 2 of 3")).toBeInTheDocument();
  });

  it("a chain: its steps in order, linked; every step needed", async () => {
    await todayIs("kinds-chain");
    renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    const chain = await within(card).findByRole("group", { name: "A pretend chain of events" });
    const steps = within(chain).getAllByRole("textbox");
    expect(steps.map((s) => s.closest("label")!.querySelector("span")!.textContent)).toEqual(["What set it off", "→ What I felt", "→ What I did"]);
    expect(chain.querySelectorAll(".exercise-chain-arrow")).toHaveLength(2);
    fireEvent.change(steps[0]!, { target: { value: "Pretend a" } });
    fireEvent.change(steps[1]!, { target: { value: "Pretend b" } });
    expect(within(card).getByRole("button", { name: "Submit" })).toBeDisabled();
    fireEvent.change(steps[2]!, { target: { value: "Pretend c" } });
    expect(within(card).getByRole("button", { name: "Submit" })).toBeEnabled();
  });
});
