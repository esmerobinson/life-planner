import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import { importExerciseCards, readExerciseCards, readExerciseProgress, saveExerciseMark } from "../../data/repo";
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
  expect(within(s).getByRole("checkbox", { name: "Done" })).not.toBeChecked();
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

it("Done: stays today's card, ticked, 'Done for today · next card tomorrow'; unticking brings it back", async () => {
  await confirmedDevice(db, jk);
  await imported();
  const device = await getDeviceId(db);
  await saveExerciseMark(jk, "2026-10-29", device, "day-1", true);
  renderApp("/journal", TODAY);
  const s = await section();
  expect(await within(s).findByText("The fictional kettle")).toBeInTheDocument();
  expect(within(s).getByText("Good one to bring to a session")).toBeInTheDocument();
  expect(within(s).queryByText("Made-up skill A")).toBeNull(); // card 2 has no skill
  await userEvent.click(within(s).getByRole("checkbox", { name: "Done" }));
  expect(await within(s).findByText("Done for today · next card tomorrow")).toBeInTheDocument();
  expect(within(s).getByRole("checkbox", { name: "Done" })).toBeChecked();
  expect((await readExerciseProgress(jk)).marks.find((m) => m.date === TODAY)).toEqual({ date: TODAY, device, id: "day-2", done: true, primary: true });
  await userEvent.click(within(s).getByRole("checkbox", { name: "Done" }));
  await waitFor(() => expect(within(s).queryByText("Done for today · next card tomorrow")).toBeNull());
  expect(within(s).getByText("The fictional kettle")).toBeInTheDocument();
});

it("Do the next one →: opens the next card not yet done with its own box; nothing is marked until its Submit, which marks it done today", async () => {
  await confirmedDevice(db, jk);
  await imported();
  const device = await getDeviceId(db);
  renderApp("/journal", TODAY);
  const s = await section();
  const today = await within(s).findByRole("article", { name: "Today's card" });
  await within(today).findByRole("textbox", { name: "Your response" });
  const rows = await db.journal.count();
  await userEvent.click(within(today).getByRole("button", { name: "Do the next one →" }));
  const next = within(s).getByRole("article", { name: "Next card: Day 2" });
  expect(within(next).getByText("The fictional kettle")).toBeInTheDocument();
  expect(within(today).queryByRole("button", { name: "Do the next one →" })).toBeNull(); // it moves to the last card
  await new Promise((r) => setTimeout(r, 50));
  expect(await db.journal.count()).toBe(rows);
  await userEvent.type(await within(next).findByRole("textbox", { name: "Your response" }), "Pretend kettle words");
  await userEvent.click(within(next).getByRole("button", { name: "Submit" }));
  expect(await within(next).findByText("Saved")).toBeInTheDocument();
  await waitFor(async () =>
    expect((await readExerciseProgress(jk)).marks).toEqual([
      { date: TODAY, device, id: "day-1", done: false, primary: true },
      { date: TODAY, device, id: "day-2", done: true, primary: false },
    ]),
  );
  // The Home row counts today as done; today's card stays card 1 (not done); another next one follows.
  expect(within(today).getByText("Pretend weather")).toBeInTheDocument();
  expect(within(today).getByRole("checkbox", { name: "Done" })).not.toBeChecked();
  await userEvent.click(within(next).getByRole("button", { name: "Do the next one →" }));
  expect(within(s).getByRole("article", { name: "Next card: Day 3" })).toBeInTheDocument();
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
