import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import {
  cardRef, importExerciseCards, readExerciseEntry, readExerciseProgress, saveExerciseMark, submitExerciseEntry,
} from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { parseCardFile } from "../../journal/exercise";
import { getDeviceId } from "../../sync/engine";
import { FAKE_CARD_TEXT_V2 } from "../../test/exerciseCards";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";

// Journal v2's exercise tab with a version 2 card file: the chapter line, Read more with its
// sources, optional cards, cards with parts (one input per part), the example, and her
// responses under All cards and in Read back. Fictional cards, links and words only.

const PASS = "fake-journal-passphrase-for-tests";
const TODAY = "2026-11-02";
const SET = parseCardFile(FAKE_CARD_TEXT_V2)!;
const KETTLE = SET.cards[2]!; // Day 2, with parts
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor(PASS);
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
  await confirmedDevice(db, jk);
  await importExerciseCards(jk, SET, "2026-10-01");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const section = () => screen.findByRole("region", { name: "Mental health exercise" });
const todayCard = async () => within(await section()).findByRole("article", { name: "Today's card" });
/** Day 1 done yesterday, so today's card is the kettle (with parts). */
const kettleToday = async () => saveExerciseMark(jk, "2026-11-01", await getDeviceId(db), "pretend-ch1-weather", true);

it("today's card: the Day chip and theme, the chapter line, the streak; the Introduction is not today's card", async () => {
  renderApp("/journal/exercise", TODAY);
  const card = await todayCard();
  expect(within(card).getByText("Day 1")).toHaveClass("chip", "exercise-day");
  expect(within(card).getByText("Pretend weather")).toHaveClass("exercise-theme");
  expect(within(card).getByText("Chapter 1 · Pretend basics")).toHaveClass("journal-muted");
  expect(within(card).queryByText("Introduction")).toBeNull();
});

it("Read more: closed at first; opens a box of paragraphs and the sources, each opening safely in a new tab", async () => {
  renderApp("/journal/exercise", TODAY);
  const card = await todayCard();
  const more = within(card).getByText("Read more").closest("details")!;
  expect(more).not.toHaveAttribute("open");
  await userEvent.click(within(card).getByText("Read more"));
  expect(within(more).getByText("A made-up first paragraph about pretend clouds.").tagName).toBe("P");
  expect(within(more).getByText("A made-up second paragraph: clouds pass, hills stay.")).toBeInTheDocument();
  const link = within(more).getByRole("link", { name: "Pretend Cloud Society: About clouds" });
  expect(link).toHaveAttribute("href", "https://example.org/pretend-clouds");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  expect(within(more).getAllByRole("link")).toHaveLength(2);
});

it("no Read more on a card without it", async () => {
  await kettleToday();
  renderApp("/journal/exercise", TODAY);
  const card = await todayCard();
  await within(card).findByText("The fictional kettle");
  expect(within(card).queryByText("Read more")).toBeNull();
});

it("All cards: the optional Introduction first, as optional reading; then the days", async () => {
  renderApp("/journal/exercise", TODAY);
  const s = await section();
  await todayCard();
  await userEvent.click(within(s).getByText("All cards"));
  const items = within(within(s).getByRole("list", { name: "All cards" })).getAllByRole("listitem");
  expect(items.map((i) => i.querySelector("summary > span")!.textContent)).toEqual([
    "Introduction (optional reading)", "Day 1 · Pretend weather", "Day 2 · The fictional kettle", "Day 3 · Imaginary pebbles",
    "Day 4 · A pretend lighthouse",
  ]);
});

describe("a card with parts", () => {
  it("one input per part; Submit only once every part is filled (every line of the list); 'N of 3 filled'", async () => {
    await kettleToday();
    renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    await within(card).findByText("The fictional kettle");
    expect(within(card).queryByRole("textbox", { name: "Your response" })).toBeNull();
    const submit = await within(card).findByRole("button", { name: "Submit" });
    expect(submit).toBeDisabled();
    await userEvent.type(within(card).getByRole("textbox", { name: "What does your pretend whistle sound like?" }), "Pretend high");
    const lines = [1, 2, 3].map((n) => within(card).getByRole("textbox", { name: `Three pretend places you feel it, ${n}` }));
    expect(within(card).getByText("0 of 3 filled")).toBeInTheDocument();
    await userEvent.type(lines[0]!, "Pretend chest");
    await userEvent.type(lines[1]!, "Pretend hands");
    expect(within(card).getByText("2 of 3 filled")).toBeInTheDocument();
    const rating = within(card).getByRole("group", { name: "How loud is it right now?" });
    expect(within(rating).getAllByRole("button").map((b) => b.textContent)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    await userEvent.click(within(rating).getByRole("button", { name: "7" }));
    expect(within(rating).getByRole("button", { name: "7" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(within(card).getByRole("group", { name: "Which pretend kettle is it?" })).getByRole("button", { name: "Tin" }));
    expect(submit).toBeDisabled(); // one line still empty: "if I have to complete 10, I complete 10"
    await userEvent.type(lines[2]!, "Pretend feet");
    expect(within(card).getByText("3 of 3 filled")).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Submit" }));
    expect(await within(card).findByText("Saved")).toBeInTheDocument();
    const entry = (await readExerciseEntry(jk, TODAY, cardRef(KETTLE))).entry!;
    expect(entry.parts!.map((a) => a.answer)).toEqual(["Pretend high", ["Pretend chest", "Pretend hands", "Pretend feet"], 7, "Tin"]);
    expect((await readExerciseProgress(jk)).marks.find((m) => m.date === TODAY)).toMatchObject({ id: KETTLE.id, done: true });
    expect(JSON.stringify(await db.journal.toArray())).not.toContain("Pretend chest");
  });

  it("a part-filled draft autosaves and comes back", async () => {
    await kettleToday();
    const view = renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    const line = await within(card).findByRole("textbox", { name: "Three pretend places you feel it, 2" });
    fireEvent.change(line, { target: { value: "Pretend knees" } });
    fireEvent.blur(line);
    await waitFor(async () => expect((await readExerciseEntry(jk, TODAY, cardRef(KETTLE))).entry?.parts?.[1]?.answer).toEqual(["", "Pretend knees", ""]));
    view.unmount();
    vi.useRealTimers();
    renderApp("/journal/exercise", TODAY);
    const again = await todayCard();
    expect(await within(again).findByRole("textbox", { name: "Three pretend places you feel it, 2" })).toHaveValue("Pretend knees");
    expect(within(again).getByText("1 of 3 filled")).toBeInTheDocument();
  });

  it("See an example (closed at first) and where her book has its own", async () => {
    await kettleToday();
    renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    await within(card).findByText("The fictional kettle");
    const ex = (await within(card).findByText("See an example")).closest("details")!;
    expect(ex).not.toHaveAttribute("open");
    await userEvent.click(within(card).getByText("See an example"));
    expect(within(ex).getByText("A made-up example: it sounds like a small pretend train.")).toBeInTheDocument();
    expect(within(card).getByText("Your book has its own example in Pretend workbook, page 2")).toHaveClass("journal-muted");
  });
});

describe("reviewing past work", () => {
  it("All cards: a card she answered lists her responses (date and answers), newest first", async () => {
    const device = await getDeviceId(db);
    const parts = (w: string) => [
      { prompt: "What does your pretend whistle sound like?", kind: "text" as const, answer: w },
      { prompt: "Three pretend places you feel it", kind: "list" as const, answer: ["a", "b", "c"] },
      { prompt: "How loud is it right now?", kind: "rating" as const, answer: 3 },
      { prompt: "Which pretend kettle is it?", kind: "choice" as const, answer: "Glass" },
    ];
    await submitExerciseEntry(jk, "2026-10-20", device, cardRef(KETTLE), parts("Pretend older"));
    await submitExerciseEntry(jk, "2026-10-27", device, cardRef(KETTLE), parts("Pretend newer"));
    renderApp("/journal/exercise", TODAY);
    const s = await section();
    await todayCard();
    await userEvent.click(within(s).getByText("All cards"));
    const kettle = within(within(s).getByRole("list", { name: "All cards" })).getAllByRole("listitem")[2]!;
    await userEvent.click(within(kettle).getByText("Day 2 · The fictional kettle"));
    const mine = within(kettle).getByRole("list", { name: "Your responses" });
    const items = within(mine).getAllByRole("listitem").filter((li) => li.parentElement === mine);
    expect(items.map((li) => li.querySelector("b")!.textContent)).toEqual(["Tuesday 27 October", "Tuesday 20 October"]);
    expect(within(items[0]!).getByText("Pretend newer")).toBeInTheDocument();
    expect(within(items[0]!).getByText("3 out of 10")).toBeInTheDocument();
    expect(within(items[0]!).getByText("Glass")).toBeInTheDocument();
    expect(within(items[0]!).queryByRole("textbox")).toBeNull(); // read-only
  });

  it("Read back lists exercise responses, check-ins and pages by date, newest first", async () => {
    const device = await getDeviceId(db);
    await submitExerciseEntry(jk, "2026-11-01", device, cardRef(SET.cards[1]!), "Pretend cloud thoughts");
    renderApp("/journal/read-back", TODAY);
    const list = await screen.findByRole("list", { name: "Read back" }, { timeout: 5000 });
    await userEvent.click(within(list).getByText("Sunday 1 November · Exercise · Day 1 · Pretend weather"));
    expect(within(list).getByText("Pretend cloud thoughts")).toBeInTheDocument();
  });
});

it("cards whose chunks haven't all arrived yet: 'Your cards are still syncing…'", async () => {
  await db.journal.delete("cards:0");
  renderApp("/journal/exercise", TODAY);
  expect(await within(await section()).findByText("Your cards are still syncing…")).toBeInTheDocument();
  expect(screen.queryByRole("article", { name: "Today's card" })).toBeNull();
});
