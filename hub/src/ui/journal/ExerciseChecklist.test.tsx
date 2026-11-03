import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import { cardRef, importExerciseCards, readExerciseEntry, readExerciseProgress, saveExerciseMark, submitExerciseEntry } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { checkCardFile, type PartValue } from "../../journal/exercise";
import { fitChecklist } from "./ExerciseResponseBox";
import { getDeviceId } from "../../sync/engine";
import { FAKE_CARD_FILE_CHECKLIST, PRETEND_FEATURES } from "../../test/exerciseCards";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";

// The checklist part: each item answered with one of the card's own options (and perhaps a
// short note), with the items on the card. Plus the scale part with no end labels.
// Fictional cards and words only.

const PASS = "fake-journal-passphrase-for-tests";
const TODAY = "2026-11-02";
const SET = checkCardFile(FAKE_CARD_FILE_CHECKLIST)!;
const NOTES = SET.cards[0]!;
const PLAIN = SET.cards[1]!;
const PROMPT = "Go through the pretend features in your made-up book. Does each one fit you?";
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor(PASS);
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
  await confirmedDevice(db, jk);
  await importExerciseCards(jk, SET, "2026-10-01");
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Unmounting saves an unsaved draft; let that land before the next test clears the database,
  // or it would leave her half-answered checklist in the next test.
  cleanup();
  await new Promise((r) => setTimeout(r, 150));
});

const section = () => screen.findByRole("region", { name: "Mental health exercise" });
const todayCard = async () => within(await section()).findByRole("article", { name: "Today's card" });
/** Make the card with this id today's (the ones before it done on earlier days). */
async function todayIs(id: string) {
  const device = await getDeviceId(db);
  const ids = SET.cards.map((c) => c.id);
  for (const [i, x] of ids.slice(0, ids.indexOf(id)).entries()) await saveExerciseMark(jk, `2026-10-2${i}`, device, x, true);
}
const pills = (row: HTMLElement) => within(row).getAllByRole("button").map((b) => b.textContent);
const rowOf = (card: HTMLElement, item: string) => within(card).getByRole("group", { name: item });
const answerOf = async (card: typeof NOTES) => (await readExerciseEntry(jk, TODAY, cardRef(card))).entry!.parts![0]!.answer;

describe("a checklist card", () => {
  it("shows the prompt, every item with its options as pills, and a note box with its placeholder", async () => {
    renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    const part = await within(card).findByRole("group", { name: PROMPT });
    expect(part.querySelector("legend")).toHaveTextContent(PROMPT);
    for (const item of PRETEND_FEATURES) {
      expect(within(card).getByText(item)).toBeInTheDocument();
      expect(pills(rowOf(card, item))).toEqual(["Yes", "Partly", "No"]);
      expect(rowOf(card, item)).toHaveClass("btn-group", "exercise-choice");
      expect(within(card).getByRole("textbox", { name: `${item}, note` })).toHaveAttribute("placeholder", "An example (optional)");
    }
    expect(within(card).getByText("0 of 4 answered")).toHaveClass("journal-muted");
    expect(within(card).getByRole("button", { name: "Submit" })).toBeDisabled();
  });

  it("no note box when the card's note is empty", async () => {
    await todayIs("check-plain");
    renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    expect(await within(card).findByRole("group", { name: "Pretend walk" })).toBeInTheDocument();
    expect(pills(rowOf(card, "Pretend tea"))).toEqual(["Done", "Not yet"]);
    expect(within(card).queryByRole("textbox")).toBeNull();
  });

  it("single select per item; tapping again clears; the count line counts per option (only those above 0)", async () => {
    renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    await within(card).findByRole("group", { name: PRETEND_FEATURES[0] });
    const press = (item: string, option: string) => userEvent.click(within(rowOf(card, item)).getByRole("button", { name: option }));
    await press("Pretend feature one", "Yes");
    await press("Pretend feature two", "Yes");
    await press("Pretend feature three", "Partly");
    expect(within(card).getByText("3 of 4 answered · Yes 2 · Partly 1")).toBeInTheDocument();
    await press("Pretend feature one", "No"); // switches (single select)
    expect(within(rowOf(card, "Pretend feature one")).getByRole("button", { name: "Yes" })).toHaveAttribute("aria-pressed", "false");
    expect(within(rowOf(card, "Pretend feature one")).getByRole("button", { name: "No" })).toHaveAttribute("aria-pressed", "true");
    expect(within(card).getByText("3 of 4 answered · Yes 1 · Partly 1 · No 1")).toBeInTheDocument();
    await press("Pretend feature one", "No"); // tap again: cleared
    expect(within(rowOf(card, "Pretend feature one")).getByRole("button", { name: "No" })).toHaveAttribute("aria-pressed", "false");
    expect(within(card).getByText("2 of 4 answered · Yes 1 · Partly 1")).toBeInTheDocument();
  });

  it("Submit once every item has a choice (a note alone is not an answer); the answer keeps each item with choice and note", async () => {
    renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    await within(card).findByRole("group", { name: PRETEND_FEATURES[0] });
    const submit = within(card).getByRole("button", { name: "Submit" });
    await userEvent.type(within(card).getByRole("textbox", { name: "Pretend feature four, note" }), "Pretend only a note");
    for (const [item, option] of [["Pretend feature one", "Yes"], ["Pretend feature two", "Partly"], ["Pretend feature three", "No"]] as const) {
      await userEvent.click(within(rowOf(card, item)).getByRole("button", { name: option }));
    }
    expect(submit).toBeDisabled();
    expect(within(card).getByText("3 of 4 answered · Yes 1 · Partly 1 · No 1")).toBeInTheDocument();
    await userEvent.click(within(rowOf(card, "Pretend feature four")).getByRole("button", { name: "Yes" }));
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    expect(await within(card).findByText("Saved", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(await answerOf(NOTES)).toEqual([
      ["Pretend feature one", "Yes", ""], ["Pretend feature two", "Partly", ""], ["Pretend feature three", "No", ""],
      ["Pretend feature four", "Yes", "Pretend only a note"],
    ]);
    expect((await readExerciseProgress(jk)).marks.find((m) => m.date === TODAY)).toMatchObject({ id: NOTES.id, done: true });
    expect(JSON.stringify(await db.journal.toArray())).not.toContain("Pretend only a note");
  });

  it("a draft autosaves (choice and note) and comes back", async () => {
    const view = renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    await within(card).findByRole("group", { name: PRETEND_FEATURES[0] });
    await userEvent.click(within(rowOf(card, "Pretend feature two")).getByRole("button", { name: "Partly" }));
    const note = within(card).getByRole("textbox", { name: "Pretend feature two, note" });
    await userEvent.type(note, "Pretend sometimes");
    await userEvent.tab(); // leaving the box saves
    await waitFor(async () => expect((await answerOf(NOTES) as string[][])[1]).toEqual(["Pretend feature two", "Partly", "Pretend sometimes"]));
    view.unmount();
    vi.useRealTimers();
    renderApp("/journal/exercise", TODAY);
    const again = await todayCard();
    expect(await within(again).findByRole("textbox", { name: "Pretend feature two, note" })).toHaveValue("Pretend sometimes");
    expect(within(rowOf(again, "Pretend feature two")).getByRole("button", { name: "Partly" })).toHaveAttribute("aria-pressed", "true");
    expect(within(again).getByText("1 of 4 answered · Partly 1")).toBeInTheDocument();
  });

  it("review (All cards, Read back) shows each item with its choice and note", async () => {
    const device = await getDeviceId(db);
    const answer = [
      ["Pretend feature one", "Yes", "Pretend because tea"], ["Pretend feature two", "Partly", ""],
      ["Pretend feature three", "No", ""], ["Pretend feature four", "Yes", ""],
    ];
    await submitExerciseEntry(jk, "2026-11-01", device, cardRef(NOTES), [{ prompt: PROMPT, kind: "checklist", answer }]);
    const view = renderApp("/journal/exercise", TODAY);
    const s = await section();
    await todayCard();
    await userEvent.click(within(s).getByText("All cards"));
    const row = within(within(s).getByRole("list", { name: "All cards" })).getAllByRole("listitem")[0]!;
    await userEvent.click(within(row).getByText("Day 1 · Pretend checklist"));
    const mine = within(row).getByRole("list", { name: "Your responses" });
    expect(within(mine).getByText(PROMPT)).toBeInTheDocument();
    const lines = within(mine).getAllByRole("listitem").filter((li) => li.classList.contains("exercise-check-answer")).map((li) => li.textContent);
    expect(lines).toEqual([
      "Pretend feature one: Yes — Pretend because tea", "Pretend feature two: Partly", "Pretend feature three: No", "Pretend feature four: Yes",
    ]);
    view.unmount();
    renderApp("/journal/read-back", TODAY);
    const list = await screen.findByRole("list", { name: "Read back" }, { timeout: 5000 });
    await userEvent.click(within(list).getByText(/Sunday 1 November · Exercise · Day 1 · Pretend checklist/));
    expect(within(list).getByText("Pretend feature one: Yes — Pretend because tea")).toBeInTheDocument();
    expect(within(list).getByText("Pretend feature three: No")).toBeInTheDocument();
  });

  it("an item left unanswered reads back as Not answered", async () => {
    const device = await getDeviceId(db);
    const { saveExerciseDraft } = await import("../../data/repo");
    await saveExerciseDraft(jk, "2026-11-01", device, cardRef(PLAIN), [
      { prompt: PLAIN.parts[0]!.prompt, kind: "checklist", answer: [["Pretend walk", "Done", ""], ["Pretend tea", "", ""]] },
    ]);
    renderApp("/journal/read-back", TODAY);
    const list = await screen.findByRole("list", { name: "Read back" }, { timeout: 5000 });
    await userEvent.click(within(list).getByText(/Exercise · Day 2/));
    expect(within(list).getByText("Pretend walk: Done")).toBeInTheDocument();
    expect(within(list).getByText((_, el) => el?.tagName === "LI" && el.textContent === "Pretend tea: Not answered")).toBeInTheDocument();
  });
});

it("the typed note is capped at 500 characters", async () => {
  renderApp("/journal/exercise", TODAY);
  const card = await todayCard();
  expect(await within(card).findByRole("textbox", { name: "Pretend feature one, note" })).toHaveAttribute("maxlength", "500");
});

describe("re-importing the cards keeps the answers of items that are unchanged", () => {
  const part = NOTES.parts[0]!;
  const was: PartValue = [
    ["Pretend feature one", "Yes", "Pretend note one"], ["Pretend feature two", "Partly", "Pretend note two"],
    ["Pretend feature three", "No", ""], ["Pretend feature four", "Yes", "Pretend note four"],
  ];
  const withItems = (items: string[], options = part.options) => ({ ...part, items, options });

  it("the same items: all of it comes back", () => {
    expect(fitChecklist(part, was)).toEqual(was);
  });

  it("reordered items keep their own answers (matched by their words); a new item is empty", () => {
    const next = withItems(["Pretend feature four", "Pretend brand new", "Pretend feature one"]);
    expect(fitChecklist(next, was)).toEqual([
      ["Pretend feature four", "Yes", "Pretend note four"], ["Pretend brand new", "", ""], ["Pretend feature one", "Yes", "Pretend note one"],
    ]);
  });

  it("a renamed item starts empty (the others keep theirs)", () => {
    const next = withItems(["Pretend feature one", "Pretend feature 2", "Pretend feature three", "Pretend feature four"]);
    expect(fitChecklist(next, was)).toEqual([
      ["Pretend feature one", "Yes", "Pretend note one"], ["Pretend feature 2", "", ""], ["Pretend feature three", "No", ""],
      ["Pretend feature four", "Yes", "Pretend note four"],
    ]);
  });

  it("a choice that is no longer one of the options is dropped, its note kept", () => {
    expect(fitChecklist(withItems(PRETEND_FEATURES, ["Yes", "No"]), was)).toEqual([
      ["Pretend feature one", "Yes", "Pretend note one"], ["Pretend feature two", "", "Pretend note two"], ["Pretend feature three", "No", ""],
      ["Pretend feature four", "Yes", "Pretend note four"],
    ]);
  });

  it("nothing stored, or something that is not rows: all empty", () => {
    const empty = PRETEND_FEATURES.map((i) => [i, "", ""]);
    expect(fitChecklist(part, null)).toEqual(empty);
    expect(fitChecklist(part, "text")).toEqual(empty);
    expect(fitChecklist(part, [1, "x", null] as unknown as PartValue)).toEqual(empty);
  });
});

describe("a scale with no end labels", () => {
  it("still shows its numbers, and no stray label spans", async () => {
    await todayIs("check-bare-scale");
    renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    const group = await within(card).findByRole("group", { name: "How pretend-calm are you?" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["1", "2", "3", "4", "5"]);
    expect(group.querySelectorAll(".exercise-scale-end")).toHaveLength(0);
    await userEvent.click(within(group).getByRole("button", { name: "3" }));
    expect(within(group).getByRole("button", { name: "3" })).toHaveAttribute("aria-pressed", "true");
    expect(within(card).getByRole("button", { name: "Submit" })).toBeEnabled();
  });
});
