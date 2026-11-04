import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import {
  importExerciseCards, readExerciseEntry, readExerciseProgress, saveExerciseDraft, submitExerciseEntry,
} from "../../data/repo";
import { exerciseCardKey, journalAad, sealJson, type JournalKey } from "../../journal/crypto";
import { checkCardFile } from "../../journal/exercise";
import { getDeviceId } from "../../sync/engine";
import { FAKE_CARD_FILE } from "../../test/exerciseCards";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { currentUrl, renderApp } from "../../test/renderApp";

// The exercise response box and Past exercises (journal polish brief §1–2). Fictional cards
// and words only.

const PASS = "fake-journal-passphrase-for-tests";
const TODAY = "2026-10-30";
const SET = checkCardFile(FAKE_CARD_FILE)!;
const legacy = (day: number, theme: string) => ({ id: `day-${day}`, day, theme, legacy: true });
const CARD1 = legacy(1, "Pretend weather");
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
const box = async () => within(await todayCard()).findByRole("textbox", { name: "Your response" });

it("a writing box under the card (after Try this and the book line, as in the mockup), with a Submit pill", async () => {
  renderApp("/journal", TODAY);
  const card = await todayCard();
  const b = await box();
  expect(b).toHaveAttribute("placeholder", "Write your response…");
  expect(b).toHaveClass("journal-answer", "exercise-response");
  expect(Number(b.getAttribute("rows"))).toBeGreaterThanOrEqual(6);
  const tryText = within(card).getByText(/Name one pretend cloud/);
  const book = within(card).getByText("In your book: Pretend workbook, page 1");
  expect(tryText.compareDocumentPosition(book) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(book.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(card).getByText("Submitting ticks today's exercise.")).toBeInTheDocument();
  const submit = within(card).getByRole("button", { name: "Submit" });
  expect(submit).not.toHaveClass("btn-secondary");
  expect(submit).toBeDisabled(); // nothing written yet
});

it("Submit seals the response and marks today's card done; reloaded it shows 'Saved' with the text, editable, and Submit again updates the row", async () => {
  const first = renderApp("/journal", TODAY);
  const card = await todayCard();
  await userEvent.type(await box(), "Pretend cloud, floating");
  await userEvent.click(within(card).getByRole("button", { name: "Submit" }));
  await within(await section()).findByRole("article", { name: "Next card: Day 2" }, { timeout: 5000 }); // the next one takes its place
  const device = await getDeviceId(db);
  expect((await readExerciseProgress(jk)).marks).toEqual([{ date: TODAY, device, id: "day-1", done: true, primary: true }]);
  expect((await readExerciseEntry(jk, TODAY, CARD1)).entry).toMatchObject({ text: "Pretend cloud, floating", saved: true });
  expect(JSON.stringify(await db.journal.toArray())).not.toContain("floating");
  first.unmount();
  renderApp("/journal", TODAY);
  const again = await todayCard();
  // The text stays, editable.
  const b = await box();
  await waitFor(() => expect(b).toHaveValue("Pretend cloud, floating"));
  expect(await within(again).findByText("Saved")).toBeInTheDocument();
  expect(within(again).queryByRole("button", { name: "Submit" })).toBeNull();
  await userEvent.type(b, " away");
  expect(within(again).queryByText("Saved")).toBeNull();
  await userEvent.click(within(again).getByRole("button", { name: "Submit" }));
  await waitFor(async () =>
    expect((await readExerciseEntry(jk, TODAY, CARD1)).entry).toMatchObject({ text: "Pretend cloud, floating away", saved: true }),
  );
  // One submitted row (drafts have their own row, apart, so they never write over it).
  expect(await db.journal.where("kind").equals("exercise-entry").filter((r) => !r.id.endsWith("-draft")).count()).toBe(1);
});

it("autosaves a draft on blur without marking Done; it is there after a reload", async () => {
  const view = renderApp("/journal", TODAY);
  await userEvent.type(await box(), "Pretend half a thought");
  fireEvent.blur(await box());
  await waitFor(async () => expect((await readExerciseEntry(jk, TODAY, CARD1)).entry).toMatchObject({ text: "Pretend half a thought", saved: false }));
  expect((await readExerciseProgress(jk)).marks.every((m) => !m.done)).toBe(true);
  view.unmount();
  renderApp("/journal", TODAY);
  expect(await box()).toHaveValue("Pretend half a thought");
});

it("autosaves after a pause in typing", async () => {
  renderApp("/journal", TODAY);
  const b = await box();
  fireEvent.change(b, { target: { value: "Pretend typed then paused" } }); // no blur, nothing else
  expect((await readExerciseEntry(jk, TODAY, CARD1)).entry).toBeNull();
  await waitFor(async () => expect((await readExerciseEntry(jk, TODAY, CARD1)).entry?.text).toBe("Pretend typed then paused"), {
    timeout: 3000,
  });
});

it("autosaves when the app is hidden, on pagehide, and when the page is left", async () => {
  renderApp("/journal", TODAY);
  const b = await box();
  fireEvent.change(b, { target: { value: "Pretend hidden" } });
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  act(() => void document.dispatchEvent(new Event("visibilitychange")));
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  await waitFor(async () => expect((await readExerciseEntry(jk, TODAY, CARD1)).entry?.text).toBe("Pretend hidden"), { timeout: 600 });
  fireEvent.change(b, { target: { value: "Pretend pagehide" } });
  act(() => void window.dispatchEvent(new Event("pagehide")));
  await waitFor(async () => expect((await readExerciseEntry(jk, TODAY, CARD1)).entry?.text).toBe("Pretend pagehide"), { timeout: 600 });
  fireEvent.change(b, { target: { value: "Pretend left the page" } });
  await userEvent.click(screen.getByRole("link", { name: "Bin" }));
  await waitFor(() => expect(currentUrl).not.toBe("/journal/exercise"));
  await waitFor(async () => expect((await readExerciseEntry(jk, TODAY, CARD1)).entry?.text).toBe("Pretend left the page"));
  expect((await readExerciseProgress(jk)).marks.every((m) => !m.done)).toBe(true);
});

it("another device's newer response shows in the box while nothing is being typed here", async () => {
  renderApp("/journal", TODAY);
  const b = await box();
  expect(b).toHaveValue("");
  const pk = await exerciseCardKey(jk, 1, CARD1.theme);
  const id = `exercise-entry:${TODAY}:${pk}:device-phone-01`;
  const at = Date.now() + 10_000;
  await db.journal.put({
    id, kind: "exercise-entry", date: TODAY, fp: jk.fp,
    ...(await sealJson(jk.key, { v: 1, ...CARD1, text: "Pretend from the phone", submittedAt: at, at }, journalAad(id))),
  });
  await waitFor(async () => expect(await box()).toHaveValue("Pretend from the phone"));
  expect(within(await todayCard()).getByText("Saved")).toBeInTheDocument();
});

describe("Past exercises", () => {
  it("newest first as '<date> · Day N · Theme'; opening one shows the card and her response", async () => {
    const device = await getDeviceId(db);
    await submitExerciseEntry(jk, "2026-10-27", device, CARD1, "Pretend first response");
    await submitExerciseEntry(jk, "2026-10-29", device, legacy(2, "The fictional kettle"), "Pretend kettle response");
    renderApp("/journal", TODAY);
    const s = await section();
    await userEvent.click(await within(s).findByText("Past exercises"));
    const list = within(s).getByRole("list", { name: "Past exercises" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((i) => i.querySelector("summary")!.textContent)).toEqual([
      "Thursday 29 October · Day 2 · The fictional kettle",
      "Tuesday 27 October · Day 1 · Pretend weather",
    ]);
    await userEvent.click(within(items[0]!).getByText(/Day 2 · The fictional kettle/));
    expect(within(items[0]!).getByText(/a kettle whistles before it boils over/)).toBeInTheDocument();
    expect(within(items[0]!).getByText("Notice one pretend whistle in your body today.")).toBeInTheDocument();
    expect(within(items[0]!).getByText("In your book: Pretend workbook, page 2")).toBeInTheDocument();
    expect(within(items[0]!).getByText("Pretend kettle response")).toBeInTheDocument();
  });

  it("a card no longer in the set (replaced): just the stored theme and her response", async () => {
    const device = await getDeviceId(db);
    await submitExerciseEntry(jk, "2026-10-28", device, legacy(9, "A pretend card from an old set"), "Pretend old response");
    await submitExerciseEntry(jk, "2026-10-29", device, legacy(2, "An older pretend theme"), "Pretend replaced response");
    renderApp("/journal", TODAY);
    const s = await section();
    await userEvent.click(await within(s).findByText("Past exercises"));
    const items = within(within(s).getByRole("list", { name: "Past exercises" })).getAllByRole("listitem");
    // Day 2 is in the set now, but as another card: not shown as this one.
    // Said plainly as an earlier card (Esme, 2026-11-04), never passed off as the set's Day 2.
    await userEvent.click(within(items[0]!).getByText("Thursday 29 October · Earlier card (day 2) · An older pretend theme"));
    expect(within(items[0]!).getByText("Pretend replaced response")).toBeInTheDocument();
    expect(within(items[0]!).queryByText(/kettle/)).toBeNull();
    expect(within(items[0]!).queryByText("Learn")).toBeNull();
    await userEvent.click(within(items[1]!).getByText(/Earlier card \(day 9\) · A pretend card from an old set/));
    expect(within(items[1]!).getByText("Pretend old response")).toBeInTheDocument();
  });

  it("not shown when there are none", async () => {
    renderApp("/journal", TODAY);
    await box();
    expect(within(await section()).queryByText("Past exercises")).toBeNull();
  });

  it("a draft from an earlier day is kept and readable, marked as not submitted", async () => {
    const device = await getDeviceId(db);
    await saveExerciseDraft(jk, "2026-10-29", device, CARD1, "Pretend never sent");
    renderApp("/journal", TODAY);
    const s = await section();
    await userEvent.click(await within(s).findByText("Past exercises"));
    const item = within(within(s).getByRole("list", { name: "Past exercises" })).getByRole("listitem");
    await userEvent.click(within(item).getByText(/Day 1 · Pretend weather/));
    expect(within(item).getByText("Pretend never sent")).toBeInTheDocument();
    expect(within(item).getByText("Not submitted")).toBeInTheDocument();
  });
});
