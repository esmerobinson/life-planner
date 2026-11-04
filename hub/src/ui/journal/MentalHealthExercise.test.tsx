import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import { importExerciseCards, readExerciseCards, readExerciseEntry, readExerciseProgress, saveExerciseMark } from "../../data/repo";
import { journalAad, sealJson, type JournalKey } from "../../journal/crypto";
import { checkCardFile, INVALID_CARD_FILE } from "../../journal/exercise";
import { getDeviceId } from "../../sync/engine";
import { FAKE_CARD_FILE, FAKE_CARD_TEXT, FAKE_CARD_TEXT_V2 } from "../../test/exerciseCards";
import { confirmedDevice, keyFor, verifierRow } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";
import { NOT_AVAILABLE } from "./JournalStrip";
import { RESTARTS_LINE } from "./MentalHealthExercise";

// The Journal's "Mental health exercise" section (exercise brief). Fictional cards only.

const PASS = "fake-journal-passphrase-for-tests";
const TODAY = "2026-10-30";
const SET = checkCardFile(FAKE_CARD_FILE)!;
let jk: JournalKey;
let other: JournalKey;
beforeAll(async () => {
  jk = await keyFor(PASS);
  other = await keyFor("fake-other-passphrase");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const section = () => screen.findByRole("region", { name: "Mental health exercise" });
const cardFile = (text: string) => new File([text], "pretend-cards.json", { type: "application/json" });
const imported = () => importExerciseCards(jk, SET, "2026-10-01");

it("locked: only the tabs (no card, no import) under the unlock state", async () => {
  await db.journal.put(await verifierRow(jk));
  await imported().catch(() => undefined); // not confirmed: nothing is written
  renderApp("/journal", TODAY);
  expect(await screen.findByRole("heading", { name: "Unlock journal" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Mental health exercise" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Mental health exercise" }).querySelector(".tick-auto")).toHaveAttribute("title", NOT_AVAILABLE);
  expect(screen.queryByRole("region", { name: "Mental health exercise" })).toBeNull();
  expect(screen.queryByText("Add your exercise cards")).toBeNull();
  expect(screen.queryByRole("article", { name: "Today's card" })).toBeNull();
});

it("no cards yet: one line and an Import pill; importing shows card 1 and stores it sealed", async () => {
  await confirmedDevice(db, jk);
  renderApp("/journal", TODAY);
  const s = await section();
  expect(await within(s).findByText("Add your exercise cards")).toBeInTheDocument();
  expect(within(s).getByRole("button", { name: "Import" })).toHaveClass("btn-secondary");
  const input = within(s).getByLabelText("Exercise card file");
  expect(input).toHaveAttribute("accept", "application/json");
  await userEvent.upload(input, cardFile(FAKE_CARD_TEXT));
  expect(await within(s).findByText("Pretend weather")).toBeInTheDocument();
  expect(within(s).getByText("Day 1")).toHaveClass("chip", "exercise-day");
  expect(within(s).getByText("pretend", { selector: "em" })).toBeInTheDocument();
  expect(within(s).getByText(/Name one pretend cloud/)).toBeInTheDocument();
  expect(within(s).getByText("In your book: Pretend workbook, page 1")).toBeInTheDocument();
  expect(within(s).getByText("Made-up skill A")).toBeInTheDocument();
  expect(within(s).queryByText("Good one to bring to a session")).toBeNull();
  expect(within(s).queryByRole("checkbox", { name: "Done" })).toBeNull();
  expect(await readExerciseCards(jk)).toEqual({ state: "ok", set: SET });
  expect(JSON.stringify(await db.journal.toArray())).not.toContain("Pretend");
  const device = await getDeviceId(db);
  await waitFor(async () => expect((await readExerciseProgress(jk)).marks).toEqual([{ date: TODAY, device, id: "day-1", done: false, primary: true }]));
});

it("a file that isn't a card file is refused with a plain message; nothing is stored", async () => {
  await confirmedDevice(db, jk);
  renderApp("/journal", TODAY);
  const s = await section();
  const bad = JSON.stringify({ ...FAKE_CARD_FILE, cards: [{ ...FAKE_CARD_FILE.cards[0], day: 0 }] });
  await userEvent.upload(await within(s).findByLabelText("Exercise card file"), cardFile(bad));
  expect(await within(s).findByRole("alert")).toHaveTextContent(INVALID_CARD_FILE);
  expect(await db.journal.get("cards")).toBeUndefined();
  expect(within(s).getByText("Add your exercise cards")).toBeInTheDocument();
});

const PRETEND_WORDS = "Pretend cloud words";
const submit = (scope: ReturnType<typeof within>) => userEvent.click(scope.getByRole("button", { name: "Submit" }));
const articles = (s: HTMLElement) => within(s).getAllByRole("article");
const tabTick = () => screen.getByRole("link", { name: /Mental health exercise/ }).querySelector(".tick-auto.is-done");

it("there is no Done checkbox or button: Submit is the only way to finish a card", async () => {
  await confirmedDevice(db, jk);
  await imported();
  renderApp("/journal", TODAY);
  const s = await section();
  const today = await within(s).findByRole("article", { name: "Today's card" });
  expect(within(s).queryByRole("checkbox", { name: "Done" })).toBeNull();
  expect(within(s).queryByRole("button", { name: "Done" })).toBeNull();
  expect(within(s).queryByText("Done", { exact: true })).toBeNull();
  expect(await within(today).findByRole("button", { name: "Submit" })).toBeDisabled();
});

it("Submit marks today's exercise done and the card gives way, in place, to the next one (only one card on the page)", async () => {
  await confirmedDevice(db, jk);
  await imported();
  const device = await getDeviceId(db);
  renderApp("/journal", TODAY);
  const s = await section();
  const today = await within(s).findByRole("article", { name: "Today's card" });
  expect(within(s).queryByText(/saved\. Here's the next one/)).toBeNull();
  await userEvent.type(await within(today).findByRole("textbox", { name: "Your response" }), PRETEND_WORDS);
  await submit(within(today));

  // Waits on the stored mark, then the replacement card (never on a line in the card Submit replaces).
  await waitFor(async () => expect((await readExerciseProgress(jk)).marks.some((m) => m.done)).toBe(true), { timeout: 5000 });
  const next = await within(s).findByRole("article", { name: "Next card: Day 2" }, { timeout: 5000 });
  expect(articles(s)).toHaveLength(1); // not stacked
  expect(within(s).queryByRole("article", { name: "Today's card" })).toBeNull();
  expect(within(s).queryByText("Pretend weather")).toBeNull(); // the submitted card is gone from the page
  expect(within(next).getByText("The fictional kettle")).toBeInTheDocument();
  expect(await within(next).findByRole("textbox", { name: "Your response" })).toHaveValue("");
  expect(within(next).getByRole("button", { name: "Submit" })).toBeDisabled(); // its own Submit
  expect(await within(s).findByText(/Day 1 saved\. Here's the next one if you'd like to keep going\./)).toBeInTheDocument();
  // Today's exercise is ticked (as Done used to), here and on the tab.
  expect((await readExerciseProgress(jk)).marks).toEqual([{ date: TODAY, device, id: "day-1", done: true, primary: true }]);
  expect(tabTick()).not.toBeNull();
  expect(within(next).queryByText("Submitting ticks today's exercise.")).toBeNull(); // already ticked
});

it("after Submit the tab scrolls back to the top of the new card", async () => {
  await confirmedDevice(db, jk);
  await imported();
  const scrolled = vi.fn();
  Element.prototype.scrollIntoView = scrolled;
  try {
    renderApp("/journal", TODAY);
    const s = await section();
    const today = await within(s).findByRole("article", { name: "Today's card" });
    await userEvent.type(await within(today).findByRole("textbox", { name: "Your response" }), PRETEND_WORDS);
    scrolled.mockClear();
    await submit(within(today));
    await within(s).findByRole("article", { name: "Next card: Day 2" }, { timeout: 5000 });
    expect(scrolled).toHaveBeenCalledWith({ block: "start" });
    expect(scrolled.mock.contexts[0]).toHaveClass("exercise-stage");
  } finally {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
});

it("the submitted card and its answers stay reachable: 'See what you wrote' (All cards) and Read back", async () => {
  await confirmedDevice(db, jk);
  await imported();
  renderApp("/journal", TODAY);
  const s = await section();
  const today = await within(s).findByRole("article", { name: "Today's card" });
  await userEvent.type(await within(today).findByRole("textbox", { name: "Your response" }), PRETEND_WORDS);
  await submit(within(today));
  await within(s).findByRole("article", { name: "Next card: Day 2" }, { timeout: 5000 });
  await userEvent.click(within(s).getByRole("button", { name: "See what you wrote" }));
  const mine = await within(s).findByRole("list", { name: "Your responses" });
  expect(within(mine).getByText(PRETEND_WORDS)).toBeInTheDocument();
  // Read back lists it too.
  await userEvent.click(screen.getByRole("link", { name: "Read back" }));
  await userEvent.click(await screen.findByText(/Exercise · Day 1 · Pretend weather/));
  expect(await screen.findByText(PRETEND_WORDS)).toBeInTheDocument();
});

it("submitting the second card works too: it is replaced by the third, nothing unticks, both are kept", async () => {
  await confirmedDevice(db, jk);
  await imported();
  const device = await getDeviceId(db);
  renderApp("/journal", TODAY);
  const s = await section();
  const first = await within(s).findByRole("article", { name: "Today's card" });
  await userEvent.type(await within(first).findByRole("textbox", { name: "Your response" }), PRETEND_WORDS);
  await submit(within(first));
  const second = await within(s).findByRole("article", { name: "Next card: Day 2" }, { timeout: 5000 });
  await userEvent.type(await within(second).findByRole("textbox", { name: "Your response" }), "Pretend kettle words");
  await submit(within(second));
  const third = await within(s).findByRole("article", { name: "Next card: Day 3" });
  expect(articles(s)).toHaveLength(1);
  expect(within(third).getByText("Imaginary pebbles")).toBeInTheDocument();
  expect(await within(s).findByText(/Day 2 saved\. Here's the next one if you'd like to keep going\./)).toBeInTheDocument();
  await waitFor(async () =>
    expect((await readExerciseProgress(jk)).marks).toEqual([
      { date: TODAY, device, id: "day-1", done: true, primary: true },
      { date: TODAY, device, id: "day-2", done: true, primary: false },
    ]),
  );
  expect(tabTick()).not.toBeNull();
  expect(await db.journal.where("kind").equals("exercise-entry").filter((r) => !r.id.endsWith("-draft")).count()).toBe(2);
});

it("Do the next one → replaces the card in place without marking anything; the draft is kept and Back returns to it", async () => {
  await confirmedDevice(db, jk);
  await imported();
  renderApp("/journal", TODAY);
  const s = await section();
  const today = await within(s).findByRole("article", { name: "Today's card" });
  await userEvent.type(await within(today).findByRole("textbox", { name: "Your response" }), "Pretend half a thought");
  const marks = (await readExerciseProgress(jk)).marks;
  await userEvent.click(within(today).getByRole("button", { name: "Do the next one →" }));
  const next = await within(s).findByRole("article", { name: "Next card: Day 2" }, { timeout: 5000 });
  expect(articles(s)).toHaveLength(1);
  expect(within(s).queryByText(/saved\. Here's the next one/)).toBeNull();
  expect((await readExerciseProgress(jk)).marks).toEqual(marks); // nothing is marked until a Submit
  await userEvent.type(await within(next).findByRole("textbox", { name: "Your response" }), "Pretend kettle draft");
  await userEvent.click(within(next).getByRole("button", { name: "← Back to Day 1" }));
  const back = await within(s).findByRole("article", { name: "Today's card" });
  await waitFor(() => expect(within(back).getByRole("textbox", { name: "Your response" })).toHaveValue("Pretend half a thought"));
  await userEvent.click(within(back).getByRole("button", { name: "Do the next one →" }));
  const again = await within(s).findByRole("article", { name: "Next card: Day 2" }, { timeout: 5000 });
  await waitFor(() => expect(within(again).getByRole("textbox", { name: "Your response" })).toHaveValue("Pretend kettle draft"));
});

it("a draft in the next card is not lost when it is replaced, and the submitted answer is kept as submitted", async () => {
  await confirmedDevice(db, jk);
  await imported();
  const device = await getDeviceId(db);
  renderApp("/journal", TODAY);
  const s = await section();
  const first = await within(s).findByRole("article", { name: "Today's card" });
  await userEvent.type(await within(first).findByRole("textbox", { name: "Your response" }), PRETEND_WORDS);
  await submit(within(first));
  const second = await within(s).findByRole("article", { name: "Next card: Day 2" }, { timeout: 5000 });
  await userEvent.type(await within(second).findByRole("textbox", { name: "Your response" }), "Pretend unsent kettle words");
  await userEvent.click(within(second).getByRole("button", { name: "Do the next one →" }));
  await within(s).findByRole("article", { name: "Next card: Day 3" });
  await userEvent.click(within(s).getByRole("button", { name: "← Back to Day 2" }));
  const again = await within(s).findByRole("article", { name: "Next card: Day 2" }, { timeout: 5000 });
  await waitFor(() => expect(within(again).getByRole("textbox", { name: "Your response" })).toHaveValue("Pretend unsent kettle words"));
  expect((await readExerciseProgress(jk)).marks).toEqual([{ date: TODAY, device, id: "day-1", done: true, primary: true }]);
  expect((await readExerciseEntry(jk, TODAY, { id: "day-1", day: 1, theme: "Pretend weather", legacy: true })).entry).toMatchObject({
    text: PRETEND_WORDS, saved: true,
  });
});

it("reloaded after a Submit: the tab stays ticked and today's card shows what she wrote, with the next one still on offer", async () => {
  await confirmedDevice(db, jk);
  await imported();
  const view = renderApp("/journal", TODAY);
  const s = await section();
  const today = await within(s).findByRole("article", { name: "Today's card" });
  await userEvent.type(await within(today).findByRole("textbox", { name: "Your response" }), PRETEND_WORDS);
  await submit(within(today));
  await within(s).findByRole("article", { name: "Next card: Day 2" }, { timeout: 5000 });
  view.unmount();
  renderApp("/journal", TODAY);
  const again = await within(await section()).findByRole("article", { name: "Today's card" });
  await waitFor(() => expect(within(again).getByRole("textbox", { name: "Your response" })).toHaveValue(PRETEND_WORDS));
  expect(within(again).getByText("Saved")).toBeInTheDocument();
  expect(within(again).getByRole("button", { name: "Do the next one →" })).toBeInTheDocument();
  await waitFor(() => expect(tabTick()).not.toBeNull());
});

it("no card left to do: a gentle line instead (the answers still reachable)", async () => {
  await confirmedDevice(db, jk);
  await importExerciseCards(jk, checkCardFile({ ...FAKE_CARD_FILE, cards: FAKE_CARD_FILE.cards.slice(0, 1) })!, "2026-10-01");
  renderApp("/journal", TODAY);
  const s = await section();
  const today = await within(s).findByRole("article", { name: "Today's card" });
  expect(within(today).queryByRole("button", { name: "Do the next one →" })).toBeNull(); // nothing to do next
  await userEvent.type(await within(today).findByRole("textbox", { name: "Your response" }), PRETEND_WORDS);
  await submit(within(today));
  expect(await within(s).findByText(/That's every card for now\. Lovely work\./)).toBeInTheDocument();
  expect(within(s).queryAllByRole("article")).toHaveLength(0);
  expect(tabTick()).not.toBeNull();
  await userEvent.click(within(s).getByRole("button", { name: "See what you wrote" }));
  expect(within(await within(s).findByRole("list", { name: "Your responses" })).getByText(PRETEND_WORDS)).toBeInTheDocument();
});

it("the star toggles and is stored on this device's own row", async () => {
  await confirmedDevice(db, jk);
  await imported();
  renderApp("/journal", TODAY);
  const s = await section();
  const star = await within(s).findByRole("button", { name: "Star this card" });
  expect(star).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(star);
  await waitFor(() => expect(within(s).getByRole("button", { name: "Star this card" })).toHaveAttribute("aria-pressed", "true"));
  expect((await readExerciseProgress(jk)).starred).toEqual(new Set(["day-1"]));
  await userEvent.click(within(s).getByRole("button", { name: "Star this card" }));
  await waitFor(async () => expect((await readExerciseProgress(jk)).starred).toEqual(new Set()));
});

it("All cards lists every card (done / starred) and opens any one to read", async () => {
  await confirmedDevice(db, jk);
  await imported();
  const device = await getDeviceId(db);
  await saveExerciseMark(jk, "2026-10-29", device, "day-1", true);
  renderApp("/journal", TODAY);
  const s = await section();
  await within(s).findByText("The fictional kettle");
  await userEvent.click(within(s).getByText("All cards"));
  const list = within(s).getByRole("list", { name: "All cards" });
  const items = within(list).getAllByRole("listitem");
  expect(items).toHaveLength(5);
  expect(items[0]).toHaveTextContent("Day 1 · Pretend weather");
  expect(within(items[0]!).getByLabelText("done")).toBeInTheDocument();
  expect(within(items[1]!).queryByLabelText("done")).toBeNull();
  await userEvent.click(within(items[3]!).getByText("Day 4 · A pretend lighthouse"));
  expect(within(items[3]!).getByText(/doesn't chase the boats/)).toBeInTheDocument();
  await userEvent.click(within(items[3]!).getByRole("button", { name: "Star this card" }));
  await waitFor(() => expect(within(items[3]!).getByLabelText("starred")).toBeInTheDocument());
});

it("re-importing asks first: 'Replace your exercise cards?'; Cancel keeps them, Replace replaces", async () => {
  await confirmedDevice(db, jk);
  await imported();
  renderApp("/journal", TODAY);
  const s = await section();
  await within(s).findByText("Pretend weather");
  await userEvent.click(within(s).getByText("All cards"));
  const two = JSON.stringify({ ...FAKE_CARD_FILE, cards: FAKE_CARD_FILE.cards.slice(1, 3) });
  await userEvent.upload(within(s).getByLabelText("Exercise card file"), cardFile(two));
  expect(await within(s).findByText("Replace your exercise cards?")).toBeInTheDocument();
  await userEvent.click(within(s).getByRole("button", { name: "Cancel" }));
  expect(await readExerciseCards(jk)).toEqual({ state: "ok", set: SET });
  await userEvent.upload(within(s).getByLabelText("Exercise card file"), cardFile(two));
  expect(within(s).queryByText(RESTARTS_LINE)).toBeNull(); // nothing done yet: nothing to lose
  await userEvent.click(await within(s).findByRole("button", { name: "Replace" }));
  await waitFor(async () => expect((await readExerciseCards(jk) as { set: { cards: unknown[] } }).set.cards).toHaveLength(2));
});

it("replacing with cards whose ids don't match what's done says the progress restarts; matching ids say nothing", async () => {
  await confirmedDevice(db, jk);
  await imported();
  await saveExerciseMark(jk, "2026-10-29", await getDeviceId(db), "day-1", true);
  renderApp("/journal", TODAY);
  const s = await section();
  await within(s).findByText("The fictional kettle");
  await userEvent.click(within(s).getByText("All cards"));
  await userEvent.upload(within(s).getByLabelText("Exercise card file"), cardFile(FAKE_CARD_TEXT));
  expect(await within(s).findByText("Replace your exercise cards?")).toBeInTheDocument();
  expect(within(s).queryByText(RESTARTS_LINE)).toBeNull(); // the same file again: same ids
  await userEvent.click(within(s).getByRole("button", { name: "Cancel" }));
  await userEvent.upload(within(s).getByLabelText("Exercise card file"), cardFile(FAKE_CARD_TEXT_V2));
  expect(await within(s).findByText(RESTARTS_LINE)).toBeInTheDocument();
});

it("cards sealed with another key: noted, and Import still offered", async () => {
  await confirmedDevice(db, jk);
  await db.journal.put({ id: "cards", kind: "cards", date: TODAY, fp: other.fp, ...(await sealJson(other.key, { v: 1 }, journalAad("cards"))) });
  renderApp("/journal", TODAY);
  const s = await section();
  expect(await within(s).findByText("Can't open this entry on this device")).toBeInTheDocument();
  expect(within(s).getByRole("button", { name: "Import" })).toBeEnabled();
});

it("Update cards sits at the top of the tab (above the card) and opens the same import flow", async () => {
  await confirmedDevice(db, jk);
  await imported();
  renderApp("/journal", TODAY);
  const s = await section();
  const card = await within(s).findByRole("article", { name: "Today's card" });
  const update = within(s).getByRole("button", { name: "Update cards" });
  expect(update).toHaveClass("btn-secondary");
  expect(update.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const input = within(s).getByLabelText("Exercise card file (update)");
  const clicked = vi.spyOn(input, "click");
  await userEvent.click(update);
  expect(clicked).toHaveBeenCalledTimes(1); // the file picker
  const two = JSON.stringify({ ...FAKE_CARD_FILE, cards: FAKE_CARD_FILE.cards.slice(1, 3) });
  await userEvent.upload(input, cardFile(two));
  expect(await within(s).findByText("Replace your exercise cards?")).toBeInTheDocument(); // the same rules
  await userEvent.click(within(s).getByRole("button", { name: "Replace" }));
  await waitFor(async () => expect((await readExerciseCards(jk) as { set: { cards: unknown[] } }).set.cards).toHaveLength(2));
});

it("Update cards is not offered while the journal is locked", async () => {
  await db.journal.put(await verifierRow(jk));
  renderApp("/journal", TODAY);
  await screen.findByRole("heading", { name: "Unlock journal" });
  expect(screen.queryByRole("button", { name: "Update cards" })).toBeNull();
});

it("no cards yet: only the Import pill, no Update cards", async () => {
  await confirmedDevice(db, jk);
  renderApp("/journal", TODAY);
  const s = await section();
  await within(s).findByText("Add your exercise cards");
  expect(within(s).queryByRole("button", { name: "Update cards" })).toBeNull();
});
