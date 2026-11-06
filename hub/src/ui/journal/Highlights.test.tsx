import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import { createHighlight, importExerciseCards, listHighlights, openNoteSession, saveHighlightNote } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { parseCardFile } from "../../journal/exercise";
import { cardFieldTexts, describeAnchor, type HighlightField } from "../../journal/highlights";
import { getDeviceId } from "../../sync/engine";
import { FAKE_CARD_TEXT_V2 } from "../../test/exerciseCards";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { findReadBackTile, openReadBackPart } from "../../test/readBack";
import { currentUrl, renderApp } from "../../test/renderApp";
import {
  highlightCard, HIGHLIGHT_ACTION, HIGHLIGHTS_HERE, NOTE_LABEL, OPEN_HIGHLIGHT, OTHER_NOTE, REMOVE_HIGHLIGHT, REMOVE_NO, REMOVE_QUESTION, REMOVE_YES,
} from "./Highlights";
import { CARDS_CANT_OPEN, NOT_FOUND, NOTE_OR_REMOVE } from "./HighlightsReadBack";
import { FAKE_CARD_FILE_V2 } from "../../test/exerciseCards";
import { db as hubDb } from "../../data/db";

// Highlights in the Mental health exercise (Esme, 2026-11-06): select words in a card's
// learning text, "Highlight", and they stay marked; tap one for its note or Remove; Read back's
// Highlights part lists them and opens the card at the words. Fictional cards and words only.

const PASS = "fake-journal-passphrase-for-tests";
const TODAY = "2026-11-06";
const SET = parseCardFile(FAKE_CARD_TEXT_V2)!;
const WEATHER = SET.cards[1]!; // Day 1 · Pretend weather (with Read more)
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
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.getSelection()?.removeAllRanges();
});

const todayCard = async () =>
  within(await screen.findByRole("region", { name: "Mental health exercise" })).findByRole("article", { name: "Today's card" }, { timeout: 5000 });

/** Selects `words` inside `el`'s text (as a mouse drag or a phone's selection handles would). */
function select(el: Element, words: string) {
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const i = (n as Text).data.indexOf(words);
    if (i < 0) continue;
    const r = document.createRange();
    r.setStart(n, i);
    r.setEnd(n, i + words.length);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    fireEvent(document, new Event("selectionchange"));
    return;
  }
  throw new Error(`"${words}" isn't in one text node`);
}

const learnOf = (card: HTMLElement) => card.querySelector('[data-hl-field="learn"]')!;
const marks = (el: ParentNode = document) => [...el.querySelectorAll("mark.hl-mark")];

async function highlightLearn(words: string) {
  const card = await todayCard();
  select(learnOf(card), words);
  await userEvent.click(await screen.findByRole("button", { name: HIGHLIGHT_ACTION }));
  await waitFor(() => expect(marks(card).map((m) => m.textContent)).toContain(words));
}

const anchor = (field: HighlightField, words: string) => {
  const text = cardFieldTexts(WEATHER)[field];
  return describeAnchor(field, text, text.indexOf(words), text.indexOf(words) + words.length)!;
};

it("select words in Learn, Highlight: they are marked, and still marked after a reload", async () => {
  renderApp("/journal/exercise", TODAY);
  const card = await todayCard();
  expect(screen.queryByRole("button", { name: HIGHLIGHT_ACTION })).toBeNull();
  await highlightLearn("clouds over a made-up hill");
  // The button goes once used.
  expect(screen.queryByRole("button", { name: HIGHLIGHT_ACTION })).toBeNull();
  expect(learnOf(card).textContent).toBe("A made-up note: feelings drift past like pretend clouds over a made-up hill.");
  // Stored sealed: the words are nowhere in clear.
  const rows = await db.journal.where("kind").equals("highlight").toArray();
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toMatch(/clouds|hill/);

  cleanup();
  renderApp("/journal/exercise", TODAY);
  const again = await todayCard();
  await waitFor(() => expect(marks(again).map((m) => m.textContent)).toEqual(["clouds over a made-up hill"]));
});

it("a selection across emphasis is one highlight of the words as they show", async () => {
  renderApp("/journal/exercise", TODAY);
  const card = await todayCard();
  const learn = learnOf(card);
  const texts = [...learn.childNodes];
  const r = document.createRange();
  r.setStart(texts[0]!, "A made-up note: feelings drift past ".length);
  r.setEnd(texts[2]!, " clouds".length);
  document.getSelection()!.addRange(r);
  fireEvent(document, new Event("selectionchange"));
  await userEvent.click(await screen.findByRole("button", { name: HIGHLIGHT_ACTION }));
  await waitFor(async () => expect((await listHighlights(jk)).highlights.map((h) => h.anchor.exact)).toEqual(["like pretend clouds"]));
  await waitFor(() => expect(learn.querySelector("mark em")?.textContent).toBe("pretend"));
});

it("words in her own answer box, or in a heading, never offer Highlight", async () => {
  renderApp("/journal/exercise", TODAY);
  const card = await todayCard();
  // Her answer box (review M12): words typed and selected there are hers, never card text.
  const box = (await within(card).findByLabelText("Your response", {}, { timeout: 5000 })) as HTMLTextAreaElement;
  await userEvent.type(box, "Pretend words of her own");
  box.setSelectionRange(0, 7);
  const r = document.createRange();
  r.selectNodeContents(box);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(r);
  fireEvent(document, new Event("selectionchange"));
  expect(screen.queryByRole("button", { name: HIGHLIGHT_ACTION })).toBeNull();
  select(within(card).getByRole("heading", { name: "Learn" }), "Learn");
  expect(screen.queryByRole("button", { name: HIGHLIGHT_ACTION })).toBeNull();
  select(within(card).getByText("Chapter 1 · Pretend basics"), "Pretend basics");
  expect(screen.queryByRole("button", { name: HIGHLIGHT_ACTION })).toBeNull();
});

it("the book line's label is never part of a highlight", async () => {
  renderApp("/journal/exercise", TODAY);
  const card = await todayCard();
  const book = card.querySelector('[data-hl-field="book"]')!;
  const r = document.createRange();
  r.setStart(book.firstChild!, 3); // inside "In your book: "
  r.setEnd(book.lastChild!, "Pretend workbook".length);
  document.getSelection()!.addRange(r);
  fireEvent(document, new Event("selectionchange"));
  await userEvent.click(await screen.findByRole("button", { name: HIGHLIGHT_ACTION }));
  await waitFor(async () => expect((await listHighlights(jk)).highlights.map((h) => h.anchor.exact)).toEqual(["Pretend workbook"]));
});

it("tap a highlight: add a note (saved as she types and when she closes it); it's there when she comes back", async () => {
  renderApp("/journal/exercise", TODAY);
  await highlightLearn("clouds over a made-up hill");
  await userEvent.click(marks(await todayCard())[0]!);
  const sheet = await screen.findByRole("dialog", { name: "Highlight" });
  expect(within(sheet).getByText("clouds over a made-up hill")).toBeInTheDocument();
  await userEvent.type(within(sheet).getByLabelText(NOTE_LABEL), "Pretend note to myself");
  await userEvent.click(within(sheet).getByRole("button", { name: "Done" }));
  await waitFor(async () => expect((await listHighlights(jk)).highlights[0]!.note).toBe("Pretend note to myself"));
  expect(JSON.stringify(await db.journal.where("kind").equals("highlight").toArray())).not.toContain("Pretend note");

  cleanup();
  renderApp("/journal/exercise", TODAY);
  await waitFor(async () => expect(marks(await todayCard())).toHaveLength(1));
  await userEvent.click(marks(await todayCard())[0]!);
  expect(within(await screen.findByRole("dialog", { name: "Highlight" })).getByLabelText(NOTE_LABEL)).toHaveValue("Pretend note to myself");
});

it("Remove asks first; Keep it keeps it; Remove takes the mark away (its rows stay, as a tombstone)", async () => {
  renderApp("/journal/exercise", TODAY);
  await highlightLearn("clouds over a made-up hill");
  await userEvent.click(marks(await todayCard())[0]!);
  const sheet = await screen.findByRole("dialog", { name: "Highlight" });
  await userEvent.click(within(sheet).getByRole("button", { name: REMOVE_HIGHLIGHT }));
  const ask = within(sheet).getByRole("group", { name: REMOVE_QUESTION });
  await userEvent.click(within(ask).getByRole("button", { name: REMOVE_NO }));
  expect((await listHighlights(jk)).highlights).toHaveLength(1);
  await userEvent.click(within(sheet).getByRole("button", { name: REMOVE_HIGHLIGHT }));
  await userEvent.click(within(within(sheet).getByRole("group", { name: REMOVE_QUESTION })).getByRole("button", { name: REMOVE_YES }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Highlight" })).toBeNull());
  await waitFor(async () => expect(marks(await todayCard())).toHaveLength(0));
  expect((await listHighlights(jk)).highlights).toEqual([]);
  expect(await db.journal.where("kind").equals("highlight").count()).toBe(2);
});

describe("Read back's Highlights part", () => {
  it("a fifth tile after the four, with its count and last day", async () => {
    await createHighlight(jk, TODAY, await getDeviceId(db), highlightCard(WEATHER, ""), anchor("learn", "made-up hill"));
    renderApp("/journal/read-back", TODAY);
    const region = await screen.findByRole("region", { name: "Read back" });
    await waitFor(() =>
      expect(within(region).getAllByRole("button").map((b) => b.querySelector(".journal-readback-tile-name")?.textContent)).toEqual([
        "Mental health exercise", "Morning pages", "Daily check-in", "Notes to myself", "Highlights",
      ]),
    );
    await waitFor(async () => expect(await findReadBackTile("Highlights")).toHaveTextContent(/^Highlights1Last: /));
  });

  it("lists each highlight with its words, note and card, by workbook and chapter, newest first; tapping one opens the card at the words", async () => {
    const me = await getDeviceId(db);
    await createHighlight(jk, TODAY, me, highlightCard(WEATHER, ""), anchor("learn", "made-up hill"), "Pretend hill note");
    await new Promise((r) => setTimeout(r, 5)); // made a moment later: newest first
    await createHighlight(jk, TODAY, me, highlightCard(WEATHER, ""), anchor("more", "clouds pass, hills stay"));
    renderApp("/journal/read-back", TODAY);
    const part = await openReadBackPart("Highlights");
    expect(within(part).getByRole("heading", { name: "Your cards" })).toBeInTheDocument();
    const list = within(part).getByRole("list", { name: "Your cards · Chapter 1 · Pretend basics" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector(".hl-quote")!.textContent)).toEqual(["clouds pass, hills stay", "made-up hill"]);
    expect(items[1]).toHaveTextContent("Pretend hill note");
    expect(items[1]).toHaveTextContent("Day 1 · Pretend weather");
    expect(within(part).queryByText(NOT_FOUND)).toBeNull();

    // The Read more one: the card opens in the chapter map, Read more open, at its words.
    await userEvent.click(items[0]!.querySelector("button.hl-entry")!);
    await waitFor(() => expect(currentUrl).toBe("/journal/exercise"));
    const map = await screen.findByRole("dialog", { name: "Your workbooks" }, { timeout: 5000 });
    await waitFor(() => expect(marks(map).map((m) => m.textContent)).toEqual(["made-up hill", "clouds pass, hills stay"]));
    await waitFor(() => expect(marks(map)[1]!.closest("details")).toHaveAttribute("open"));
  });

  it("a highlight whose words aren't in the card any more still shows, word for word, and says so", async () => {
    const me = await getDeviceId(db);
    const gone = { ...anchor("learn", "made-up hill"), exact: "Pretend words since rewritten", prefix: "", suffix: "" };
    await createHighlight(jk, TODAY, me, highlightCard(WEATHER, ""), gone, "Pretend kept note");
    await createHighlight(jk, TODAY, me, { ...highlightCard(WEATHER, "Pretend old book"), id: "pretend-card-no-longer-here", day: 9 }, anchor("learn", "made-up hill"));
    renderApp("/journal/read-back", TODAY);
    const part = await openReadBackPart("Highlights");
    const quotes = [...part.querySelectorAll(".hl-quote")].map((q) => q.textContent);
    expect(quotes).toEqual(expect.arrayContaining(["Pretend words since rewritten", "made-up hill"]));
    expect(within(part).getAllByText(NOT_FOUND)).toHaveLength(2);
    expect(part).toHaveTextContent("Pretend kept note");
    // The one whose card is gone is grouped under the book it was in, and isn't a link to nowhere.
    expect(within(part).getByRole("heading", { name: "Pretend old book" })).toBeInTheDocument();
    expect(part.querySelectorAll(".hl-lost")).toHaveLength(1);
    // On the card, the missing words aren't marked anywhere (never guessed).
    cleanup();
    renderApp("/journal/exercise", TODAY);
    await todayCard();
    await new Promise((r) => setTimeout(r, 50));
    expect(marks()).toHaveLength(0);
  });
});

// ---- fix round 1 (review I1, I2, I3)

const ME = () => getDeviceId(db);
const at = (field: HighlightField, words: string, from = 0) => {
  const text = cardFieldTexts(WEATHER)[field];
  const i = text.indexOf(words, from);
  return describeAnchor(field, text, i, i + words.length)!;
};

describe("review I1: never the wrong words marked", () => {
  it("re-imported card where her sentence changed but the word is elsewhere: no mark at all, and Read back says it can't be found", async () => {
    await createHighlight(jk, TODAY, await ME(), highlightCard(WEATHER, ""), at("learn", "hill"), "Pretend note about the hill");
    // The new file: Learn's sentence is rewritten; "hill" is still in Read more ("hills" doesn't count: "hill" + "s").
    const file = structuredClone(FAKE_CARD_FILE_V2) as typeof FAKE_CARD_FILE_V2;
    const weather = file.cards[1] as (typeof file.cards)[number] & { more: string };
    weather.learn = "A made-up note: feelings drift past like *pretend* clouds over a made-up field.";
    weather.more = "A made-up first paragraph about a pretend hill far away.\n\nA made-up second paragraph.";
    await importExerciseCards(jk, parseCardFile(JSON.stringify(file))!, TODAY);
    renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    await waitFor(() => expect(within(card).getByText(/over a made-up field/)).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 100));
    expect(marks()).toHaveLength(0);
    cleanup();
    renderApp("/journal/read-back", TODAY);
    const part = await openReadBackPart("Highlights");
    expect(within(part).getByText("hill")).toHaveClass("hl-quote");
    expect(within(part).getByText(NOT_FOUND)).toBeInTheDocument();
    expect(part).toHaveTextContent("Pretend note about the hill");
  });
});

describe("review I2: every highlight stays reachable", () => {
  it("a highlight made inside an older one is marked on its own; tapping its words opens ITS note", async () => {
    const me = await ME();
    await createHighlight(jk, TODAY, me, highlightCard(WEATHER, ""), at("learn", "feelings drift past like pretend clouds over a made-up hill"), "Pretend outer note");
    await new Promise((r) => setTimeout(r, 5));
    await createHighlight(jk, TODAY, me, highlightCard(WEATHER, ""), at("learn", "pretend clouds"), "Pretend inner note");
    renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    await waitFor(() => expect(marks(card).length).toBeGreaterThan(1));
    const inner = marks(card).filter((m) => m.textContent === "pretend" || m.textContent === " clouds");
    expect(inner.length).toBeGreaterThan(0);
    await userEvent.click(inner[0]!);
    // Inner words lie under both: she chooses, and each opens its own note.
    const choose = await screen.findByRole("dialog", { name: HIGHLIGHTS_HERE });
    expect(within(choose).getAllByRole("button").map((b) => b.textContent)).toEqual(
      expect.arrayContaining(["pretend clouds", "feelings drift past like pretend clouds over a made-up hill"]),
    );
    await userEvent.click(within(choose).getByRole("button", { name: "pretend clouds" }));
    const sheet = await screen.findByRole("dialog", { name: "Highlight" });
    expect(within(sheet).getByLabelText(NOTE_LABEL)).toHaveValue("Pretend inner note");
    await userEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    // The outer one's own words (outside the inner) open it directly.
    const outerOnly = marks(card).find((m) => m.textContent?.startsWith("feelings"))!;
    await userEvent.click(outerOnly);
    expect(within(await screen.findByRole("dialog", { name: "Highlight" })).getByLabelText(NOTE_LABEL)).toHaveValue("Pretend outer note");
  });

  it("selecting words already inside a highlight (a long-press on a mark) offers to open it, never a new one", async () => {
    await createHighlight(jk, TODAY, await ME(), highlightCard(WEATHER, ""), at("learn", "clouds over a made-up hill"), "Pretend note");
    renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    await waitFor(() => expect(marks(card)).toHaveLength(1));
    select(marks(card)[0]!, "made-up"); // inside the mark
    expect(screen.queryByRole("button", { name: HIGHLIGHT_ACTION })).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: OPEN_HIGHLIGHT }));
    expect(within(await screen.findByRole("dialog", { name: "Highlight" })).getByLabelText(NOTE_LABEL)).toHaveValue("Pretend note");
    expect((await listHighlights(jk)).highlights).toHaveLength(1);
    // Words reaching beyond it are new words: Highlight again.
    cleanup();
    renderApp("/journal/exercise", TODAY);
    const again = await todayCard();
    await waitFor(() => expect(marks(again)).toHaveLength(1));
    const r = document.createRange();
    const texts = [...learnOf(again).childNodes];
    r.setStart(texts[0]!, 3);
    r.setEnd(marks(again)[0]!.firstChild!, 6);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(r);
    fireEvent(document, new Event("selectionchange"));
    expect(await screen.findByRole("button", { name: HIGHLIGHT_ACTION })).toBeInTheDocument();
  });

  it("Read back opens the card at an inner highlight; and from Read back its note can be changed and it can be removed", async () => {
    const me = await ME();
    await createHighlight(jk, TODAY, me, highlightCard(WEATHER, ""), at("learn", "feelings drift past like pretend clouds over a made-up hill"));
    await new Promise((r) => setTimeout(r, 5));
    await createHighlight(jk, TODAY, me, highlightCard(WEATHER, ""), at("learn", "made-up hill"), "Pretend inner note");
    renderApp("/journal/read-back", TODAY);
    let part = await openReadBackPart("Highlights");
    const inner = within(part).getAllByRole("listitem").find((li) => li.querySelector(".hl-quote")!.textContent === "made-up hill")!;
    // Its note and Remove right here.
    await userEvent.click(within(inner).getByRole("button", { name: NOTE_OR_REMOVE }));
    const sheet = await screen.findByRole("dialog", { name: "Highlight" });
    await userEvent.clear(within(sheet).getByLabelText(NOTE_LABEL));
    await userEvent.type(within(sheet).getByLabelText(NOTE_LABEL), "Pretend changed in Read back");
    await userEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(inner).toHaveTextContent("Pretend changed in Read back"));
    // Opening its card lands on its own mark.
    await userEvent.click(inner.querySelector("button.hl-entry")!);
    const map = await screen.findByRole("dialog", { name: "Your workbooks" }, { timeout: 5000 });
    const innerKey = (await listHighlights(jk)).highlights.find((h) => h.anchor.exact === "made-up hill")!.key;
    await waitFor(() =>
      expect([...map.querySelectorAll("mark")].filter((m) => (m as HTMLElement).dataset.hlKey === innerKey).map((m) => m.textContent).join("")).toBe("made-up hill"),
    );
    // Remove from Read back.
    cleanup();
    renderApp("/journal/read-back", TODAY);
    part = await openReadBackPart("Highlights");
    const row = within(part).getAllByRole("listitem").find((li) => li.querySelector(".hl-quote")!.textContent === "made-up hill")!;
    await userEvent.click(within(row).getByRole("button", { name: NOTE_OR_REMOVE }));
    const s2 = await screen.findByRole("dialog", { name: "Highlight" });
    await userEvent.click(within(s2).getByRole("button", { name: REMOVE_HIGHLIGHT }));
    await userEvent.click(within(within(s2).getByRole("group", { name: REMOVE_QUESTION })).getByRole("button", { name: REMOVE_YES }));
    await waitFor(() => expect([...part.querySelectorAll(".hl-quote")].map((q) => q.textContent)).toEqual(["feelings drift past like pretend clouds over a made-up hill"]));
  });

  it("a highlight whose words can't be found can still have its note changed and be removed, from Read back (review M3)", async () => {
    const gone = { ...at("learn", "made-up hill"), exact: "Pretend words since rewritten", prefix: "", suffix: "" };
    await createHighlight(jk, TODAY, await ME(), highlightCard(WEATHER, ""), gone, "Pretend kept note");
    renderApp("/journal/read-back", TODAY);
    const part = await openReadBackPart("Highlights");
    await userEvent.click(within(part).getByRole("button", { name: NOTE_OR_REMOVE }));
    const sheet = await screen.findByRole("dialog", { name: "Highlight" });
    await userEvent.click(within(sheet).getByRole("button", { name: REMOVE_HIGHLIGHT }));
    await userEvent.click(within(within(sheet).getByRole("group", { name: REMOVE_QUESTION })).getByRole("button", { name: REMOVE_YES }));
    await waitFor(async () => expect((await listHighlights(jk)).highlights).toEqual([]));
  });
});

describe("review I3: her words in the note box are never replaced or lost", () => {
  it("a newer note from another device arrives while the box is open: the box keeps her words, the other shows as Also noted, both stay", async () => {
    await createHighlight(jk, TODAY, await ME(), highlightCard(WEATHER, ""), at("learn", "made-up hill"));
    const opened = (await listHighlights(jk)).highlights[0]!;
    renderApp("/journal/exercise", TODAY);
    const card = await todayCard();
    await waitFor(() => expect(marks(card)).toHaveLength(1));
    await userEvent.click(marks(card)[0]!);
    const sheet = await screen.findByRole("dialog", { name: "Highlight" });
    const box = within(sheet).getByLabelText(NOTE_LABEL);
    await userEvent.type(box, "Pretend X on the Mac");
    fireEvent.blur(box); // saved
    await waitFor(async () => expect((await listHighlights(jk)).highlights[0]!.note).toBe("Pretend X on the Mac"));
    // The phone, which had the first version open, saves its own note (newer).
    await saveHighlightNote(jk, "device-phone-01", openNoteSession(opened), "Pretend Y on the phone");
    await waitFor(() => expect(within(sheet).getByText("Pretend Y on the phone")).toBeInTheDocument());
    expect(within(sheet).getByText(OTHER_NOTE)).toBeInTheDocument();
    expect(box).toHaveValue("Pretend X on the Mac"); // never replaced
    await userEvent.type(box, ", typed on");
    await userEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(async () => {
      const [h] = (await listHighlights(jk)).highlights;
      expect([h!.note, ...h!.others].sort()).toEqual(["Pretend X on the Mac, typed on", "Pretend Y on the phone"]);
    });
    // What she sees in Read back: both, word for word.
    cleanup();
    renderApp("/journal/read-back", TODAY);
    const part = await openReadBackPart("Highlights");
    expect(part).toHaveTextContent("Pretend X on the Mac, typed on");
    expect(part).toHaveTextContent("Pretend Y on the phone");
  });
});

it("Read back says the cards can't be opened (not that the words are gone) when the card set won't open here (review M5)", async () => {
  await createHighlight(jk, TODAY, await ME(), highlightCard(WEATHER, ""), at("learn", "made-up hill"));
  const manifest = (await hubDb.journal.get("cards"))!;
  await hubDb.journal.put({ ...manifest, ct: manifest.ct.slice(0, -8) + "AAAAAAAA" }); // damaged: won't open
  renderApp("/journal/read-back", TODAY);
  const part = await openReadBackPart("Highlights");
  expect(within(part).getByText(CARDS_CANT_OPEN)).toBeInTheDocument();
  expect(within(part).queryByText(NOT_FOUND)).toBeNull();
});
