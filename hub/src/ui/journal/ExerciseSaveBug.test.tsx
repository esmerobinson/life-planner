import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import {
  cardRef, importExerciseCards, listExerciseEntries, readExerciseEntry, readExerciseProgress, saveExerciseDraft, saveExerciseMark,
  submitExerciseEntry, type PartAnswer,
} from "../../data/repo";
import { journalId } from "../../data/validate";
import { exerciseCardIdKey, journalAad, sealJson, type JournalKey } from "../../journal/crypto";
import { checkCardFile } from "../../journal/exercise";
import { getDeviceId } from "../../sync/engine";
import { FAKE_CARD_FILE_CHECKLIST, FAKE_CARD_FILE_V2, PRETEND_FEATURES } from "../../test/exerciseCards";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";
import { EARLIER_ANSWER, UNSENT_DRAFT } from "./ResponseView";

// Esme, 2026-11-04: "I submitted responses on todays exercise but cant see it in past exercises
// and it is not accurate to what i typed; i should be able to see this and easily reread what I
// wrote". Then: "theres repeats in the read back". Fictional cards and words only.

const PASS = "fake-journal-passphrase-for-tests";
const TODAY = "2026-11-04";
const SET = checkCardFile(FAKE_CARD_FILE_V2)!;
const WEATHER = SET.cards.find((c) => c.id === "pretend-ch1-weather")!;
const KETTLE = SET.cards.find((c) => c.id === "pretend-ch1-kettle")!;
const CHECKS = checkCardFile(FAKE_CARD_FILE_CHECKLIST)!;
const NOTES = CHECKS.cards[0]!;
const LONG =
  "A long made-up answer about a pretend afternoon.\nIt has a second line, and it goes on for a while so that it is clearly long, " +
  "with the very last words typed just before Submit: pretend ending";
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor(PASS);
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
  await confirmedDevice(db, jk);
});
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 150));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const section = () => screen.findByRole("region", { name: "Mental health exercise" });
const todayCard = async () => within(await section()).findByRole("article", { name: "Today's card" });
const doneToday = (id: string) =>
  waitFor(async () => expect((await readExerciseProgress(jk)).marks.some((m) => m.date === TODAY && m.id === id && m.done)).toBe(true), {
    timeout: 5000,
  });
const settle = () => new Promise((r) => setTimeout(r, 1200));

async function openReadBack() {
  cleanup();
  vi.useRealTimers();
  renderApp("/journal/read-back", TODAY);
  return screen.findByRole("list", { name: "Read back" }, { timeout: 5000 });
}

describe("a text card: type a long answer, Submit at once", () => {
  beforeEach(() => importExerciseCards(jk, SET, "2026-10-01"));

  it("stores exactly what was typed (the last keystrokes too) and it reads back in Past exercises, Read back and the card's review", async () => {
    renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    const box = await within(card).findByRole("textbox", { name: "Your response" });
    await userEvent.type(box, "Pretend start. ");
    fireEvent.change(box, { target: { value: LONG } }); // the last keystrokes, then Submit straight away
    await userEvent.click(within(card).getByRole("button", { name: "Submit" }));
    await doneToday(WEATHER.id);
    await settle();
    expect((await readExerciseEntry(jk, TODAY, cardRef(WEATHER))).entry).toMatchObject({ text: LONG, submitted: true });

    // Past exercises lists today's too.
    const s = await section();
    await userEvent.click(within(s).getByText("Past exercises"));
    const past = within(s).getByRole("list", { name: "Past exercises" });
    await userEvent.click(within(past).getByText("Wednesday 4 November · Day 1 · Pretend weather"));
    expect(within(past).getByText((_, el) => el?.tagName === "P" && el.textContent === LONG)).toBeInTheDocument();

    // "See what you wrote" opens the card's review with it.
    await userEvent.click(within(s).getByRole("button", { name: "See what you wrote" }));
    const mine = await within(s).findByRole("list", { name: "Your responses" });
    expect(within(mine).getByText((_, el) => el?.tagName === "P" && el.textContent === LONG)).toBeInTheDocument();

    const list = await openReadBack();
    await userEvent.click(within(list).getByText(/Wednesday 4 November · Exercise · Day 1 · Pretend weather/));
    expect(within(list).getByText((_, el) => el?.tagName === "P" && el.textContent === LONG)).toBeInTheDocument();
    expect(within(list).queryByText("Not submitted")).toBeNull();
  });

  it("Submit, then 'Do the next one' at once: the answer is kept under its own card, exactly", async () => {
    renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    fireEvent.change(await within(card).findByRole("textbox", { name: "Your response" }), { target: { value: LONG } });
    await userEvent.click(within(card).getByRole("button", { name: "Submit" }));
    const next = within(await section()).queryByRole("button", { name: "Do the next one →" });
    if (next) await userEvent.click(next);
    await doneToday(WEATHER.id);
    await settle();
    expect((await readExerciseEntry(jk, TODAY, cardRef(WEATHER))).entry).toMatchObject({ text: LONG, saved: true });
    expect((await readExerciseEntry(jk, TODAY, cardRef(KETTLE))).entry).toBeNull();
    const { entries } = await listExerciseEntries(jk, "2026-11-05");
    expect(entries.map((e) => [e.id, e.text])).toEqual([[WEATHER.id, LONG]]);
  });

  it("another device's newer half-typed draft never hides what she submitted; it shows below, marked as an unsent draft", async () => {
    const device = await getDeviceId(db);
    await submitExerciseEntry(jk, TODAY, device, cardRef(WEATHER), LONG);
    const id = journalId("exercise-entry", TODAY, `${await exerciseCardIdKey(jk, WEATHER.id)}:device-phone-01`);
    const at = Date.now() + 60_000;
    const entry = { v: 2, id: WEATHER.id, day: 1, theme: WEATHER.theme, text: "Pretend half", submittedAt: null, at };
    await db.journal.put({ id, kind: "exercise-entry", date: TODAY, fp: jk.fp, ...(await sealJson(jk.key, entry, journalAad(id))) });
    const list = await openReadBack();
    expect(within(list).getAllByText(/Exercise · Day 1 · Pretend weather/)).toHaveLength(1); // one entry, no repeats
    await userEvent.click(within(list).getByText(/Wednesday 4 November · Exercise · Day 1 · Pretend weather/));
    expect(within(list).getByText((_, el) => el?.tagName === "P" && el.textContent === LONG)).toBeInTheDocument();
    expect(within(list).getByText(new RegExp(UNSENT_DRAFT))).toBeInTheDocument();
    expect(within(list).getByText("Pretend half")).toBeInTheDocument();
  });
});

describe("a card with a list part", () => {
  beforeEach(async () => {
    await importExerciseCards(jk, SET, "2026-10-01");
    await saveExerciseMark(jk, "2026-10-20", await getDeviceId(db), WEATHER.id, true);
  });

  it("every part as typed, Submit at once, reads back in Read back", async () => {
    renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    await within(card).findByRole("group", { name: "Three pretend places you feel it" });
    fireEvent.change(within(card).getByRole("textbox", { name: "What does your pretend whistle sound like?" }), { target: { value: LONG } });
    for (const [i, w] of ["Pretend chest", "Pretend hands", "Pretend jaw, last keys"].entries()) {
      fireEvent.change(within(card).getByRole("textbox", { name: `Three pretend places you feel it, ${i + 1}` }), { target: { value: w } });
    }
    await userEvent.click(within(card).getByRole("button", { name: "4" }));
    await userEvent.click(within(card).getByRole("button", { name: "Tin" }));
    await userEvent.click(within(card).getByRole("button", { name: "Submit" }));
    await doneToday(KETTLE.id);
    await settle();
    const parts = (await readExerciseEntry(jk, TODAY, cardRef(KETTLE))).entry!.parts!;
    expect(parts.map((p) => p.answer)).toEqual([LONG, ["Pretend chest", "Pretend hands", "Pretend jaw, last keys"], 4, "Tin"]);
    const list = await openReadBack();
    await userEvent.click(within(list).getByText(/Exercise · Day 2 · The fictional kettle/));
    expect(within(list).getByText("Pretend jaw, last keys")).toBeInTheDocument();
    expect(within(list).getByText((_, el) => el?.tagName === "P" && el.textContent === LONG)).toBeInTheDocument();
  });

  it("re-imported with a part changed: her earlier answer still shows on the card, and Submit keeps it", async () => {
    const device = await getDeviceId(db);
    const old: PartAnswer[] = [
      { prompt: "What does your pretend whistle sound like?", kind: "text", answer: "Pretend old whistle words" },
      { prompt: "Three pretend places you feel it", kind: "list", answer: ["Pretend old a", "Pretend old b", "Pretend old c"] },
      { prompt: "How loud is it right now?", kind: "rating", answer: 3 },
      { prompt: "Which pretend kettle is it?", kind: "choice", answer: "Copper" },
    ];
    await submitExerciseEntry(jk, TODAY, device, cardRef(KETTLE), old);
    // The card file changes: the list becomes a checklist.
    const parts = [
      KETTLE.parts[0]!,
      { prompt: "Does each pretend place fit?", kind: "checklist" as const, items: ["Pretend chest"], options: ["Yes", "No"], note: "" },
    ];
    await importExerciseCards(jk, { ...SET, cards: SET.cards.map((c) => (c.id === KETTLE.id ? { ...c, parts } : c)) }, TODAY);
    renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    expect(await within(card).findByText(EARLIER_ANSWER)).toBeInTheDocument();
    expect(within(card).getByText("Pretend old b")).toBeInTheDocument();
    await userEvent.click(within(within(card).getByRole("group", { name: "Pretend chest" })).getByRole("button", { name: "Yes" }));
    await userEvent.click(within(card).getByRole("button", { name: "Submit" }));
    await waitFor(async () => expect((await readExerciseEntry(jk, TODAY, cardRef(KETTLE))).entry?.parts?.[1]?.kind).toBe("checklist"));
    const stored = (await readExerciseEntry(jk, TODAY, cardRef(KETTLE))).entry!.parts!;
    expect(stored.find((p) => p.kind === "list")?.answer).toEqual(["Pretend old a", "Pretend old b", "Pretend old c"]);
  });
});

describe("a checklist card", () => {
  beforeEach(() => importExerciseCards(jk, CHECKS, "2026-10-01"));

  it("choices and notes, Submit right after the last keystroke: exactly as typed in Read back", async () => {
    renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    await within(card).findByRole("group", { name: PRETEND_FEATURES[0] });
    for (const item of PRETEND_FEATURES) await userEvent.click(within(within(card).getByRole("group", { name: item })).getByRole("button", { name: "Yes" }));
    fireEvent.change(within(card).getByRole("textbox", { name: "Pretend feature four, note" }), { target: { value: "Pretend last note" } });
    await userEvent.click(within(card).getByRole("button", { name: "Submit" }));
    await doneToday(NOTES.id);
    await settle();
    expect((await readExerciseEntry(jk, TODAY, cardRef(NOTES))).entry!.parts![0]!.answer).toEqual([
      ["Pretend feature one", "Yes", ""], ["Pretend feature two", "Yes", ""], ["Pretend feature three", "Yes", ""],
      ["Pretend feature four", "Yes", "Pretend last note"],
    ]);
    const list = await openReadBack();
    await userEvent.click(within(list).getByText(/Exercise · Day 1 · Pretend checklist/));
    expect(within(list).getByText("Pretend feature four: Yes — Pretend last note")).toBeInTheDocument();
  });

  it("a draft alone (never submitted) reads back marked as not submitted", async () => {
    await saveExerciseDraft(jk, TODAY, await getDeviceId(db), cardRef(NOTES), [
      { prompt: NOTES.parts[0]!.prompt, kind: "checklist", answer: [["Pretend feature one", "No", "Pretend draft note"]] },
    ]);
    const list = await openReadBack();
    await userEvent.click(within(list).getByText(/Exercise · Day 1 · Pretend checklist/));
    expect(within(list).getByText("Pretend feature one: No — Pretend draft note")).toBeInTheDocument();
    expect(within(list).getByText("Not submitted")).toBeInTheDocument();
  });
});
