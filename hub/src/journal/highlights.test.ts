import { parseCardFile } from "./exercise";
import {
  resolveCard, cardFieldTexts, CONTEXT_CHARS, describeAnchor, isHighlightEntry, locateAnchor, markRuns, plainText, type HighlightEntry,
} from "./highlights";
import { FAKE_CARD_TEXT_V2 } from "../test/exerciseCards";

// Highlights (Esme, 2026-11-06): a phrase in a card's learning text, anchored like the W3C
// TextQuoteSelector (the exact words, a little context before and after) with offsets as a hint,
// so it is found again when the card's text shifts. Fictional words only.

const LEARN = "A made-up note: pretend clouds drift past a pretend hill, and pretend clouds always pass.";

describe("plain text of a card's learning text", () => {
  it("is the text as it shows: *emphasis* marks are not in it", () => {
    expect(plainText("feelings drift past like *pretend* clouds")).toBe("feelings drift past like pretend clouds");
    expect(plainText("a lone * star")).toBe("a lone * star");
  });

  it("Read more is its paragraphs as they show, a blank line between", () => {
    const set = parseCardFile(FAKE_CARD_TEXT_V2)!;
    const withMore = set.cards.find((c) => c.more.trim() !== "")!;
    const texts = cardFieldTexts(withMore);
    expect(texts.more).not.toContain("*");
    expect(texts.more.split("\n\n").length).toBeGreaterThanOrEqual(1);
    expect(texts.learn).toBe(plainText(withMore.learn));
  });
});

describe("describing a highlight", () => {
  it("keeps the exact words, up to 32 characters either side, and the offsets", () => {
    const start = LEARN.indexOf("pretend hill");
    const a = describeAnchor("learn", LEARN, start, start + "pretend hill".length)!;
    expect(a).toEqual({
      field: "learn", exact: "pretend hill", start, end: start + 12,
      prefix: LEARN.slice(start - CONTEXT_CHARS, start), suffix: LEARN.slice(start + 12, start + 12 + CONTEXT_CHARS),
    });
  });

  it("leaves out spaces at either end of what was selected, and refuses an empty selection", () => {
    const start = LEARN.indexOf(" a pretend hill");
    const a = describeAnchor("learn", LEARN, start, start + " a pretend hill ".length - 1)!;
    expect(a.exact).toBe("a pretend hill");
    expect(a.start).toBe(start + 1);
    expect(describeAnchor("learn", LEARN, 5, 5)).toBeNull();
    expect(describeAnchor("learn", LEARN, 1, 2)).toBeNull(); // only a space
  });
});

describe("finding a highlight again", () => {
  const at = (text: string, words: string, from = 0) => {
    const start = text.indexOf(words, from);
    return describeAnchor("learn", text, start, start + words.length)!;
  };

  it("exact: where it was", () => {
    const a = at(LEARN, "pretend clouds always pass");
    expect(locateAnchor(a, { learn: LEARN })).toEqual({ field: "learn", start: a.start, end: a.end });
  });

  it("of two places with the same words, the one with its own context (not just the first)", () => {
    const second = LEARN.indexOf("pretend clouds", 30);
    const a = at(LEARN, "pretend clouds", 30);
    expect(a.start).toBe(second);
    expect(locateAnchor(a, { learn: LEARN })!.start).toBe(second);
  });

  it("shifted text (a re-imported card with words added before it): found at its new place", () => {
    const a = at(LEARN, "pretend clouds always pass");
    const shifted = `A new pretend opening line. ${LEARN}`;
    const found = locateAnchor(a, { learn: shifted })!;
    expect(shifted.slice(found.start, found.end)).toBe("pretend clouds always pass");
    expect(found.start).toBe(a.start + "A new pretend opening line. ".length);
  });

  it("shifted text where the same words come twice: the context picks the right one", () => {
    const a = at(LEARN, "pretend clouds", 30);
    const shifted = LEARN.replace("A made-up note:", "A longer made-up note, changed:");
    const found = locateAnchor(a, { learn: shifted })!;
    expect(found.start).toBe(shifted.indexOf("pretend clouds", 40));
  });

  it("moved into another part of the card WITH its sentence around it (Learn to Read more): found there", () => {
    const a = at(LEARN, "pretend clouds always pass");
    const found = locateAnchor(a, { learn: "Pretend new learn text.", more: `Pretend paragraph.\n\n${LEARN}` })!;
    expect(found.field).toBe("more");
  });

  it("its line breaks or spaces changed: still found, on the words as they are now", () => {
    const a = at(LEARN, "pretend hill, and pretend clouds");
    const rewrapped = LEARN.replace("hill, and pretend", "hill,\nand  pretend");
    const found = locateAnchor(a, { learn: rewrapped })!;
    expect(rewrapped.slice(found.start, found.end)).toBe("pretend hill,\nand  pretend clouds");
  });

  // Review I1: the same words elsewhere, with nothing around them that matches, are not hers.
  it("a short word whose sentence was rewritten isn't moved to the same word elsewhere (review: 'notice')", () => {
    const learn = "A made-up note: when the pretend wave rises, notice the urge and let it pass.";
    const more = "Some people notice nothing at first. That is a pretend normal.";
    const s = learn.indexOf("notice");
    const a = describeAnchor("learn", learn, s, s + "notice".length)!;
    expect(locateAnchor(a, { learn, more })).toEqual({ field: "learn", start: s, end: s + 6 });
    const reimported = "A made-up note: when the pretend wave rises, name the urge and let it pass.";
    expect(locateAnchor(a, { learn: reimported, more })).toBeNull();
  });

  it("the second of two same phrases doesn't jump to the first when its sentence goes (review: 'Breathe in')", () => {
    const learn = "Breathe in through the pretend nose. Count to four. Breathe in again slowly, then rest.";
    const s = learn.indexOf("Breathe in", 5);
    const a = describeAnchor("learn", learn, s, s + "Breathe in".length)!;
    expect(locateAnchor(a, { learn })!.start).toBe(s);
    expect(locateAnchor(a, { learn: "Breathe in through the pretend nose. Count to four. Then rest." })).toBeNull();
  });

  it("a whole short part (no context either side) is found only as a whole part again", () => {
    const a = describeAnchor("skill", "Made-up skill A", 0, 15)!;
    expect(locateAnchor(a, { skill: "Made-up skill A" })).toEqual({ field: "skill", start: 0, end: 15 });
    expect(locateAnchor(a, { skill: "Made-up skill B", learn: "Try Made-up skill A today." })).toBeNull();
  });

  it("missing text (the words aren't in the card any more): null, never a guess", () => {
    const a = at(LEARN, "pretend clouds always pass");
    expect(locateAnchor(a, { learn: "A made-up note: completely different pretend words." })).toBeNull();
    expect(locateAnchor(a, {})).toBeNull();
  });
});

describe("marking the text", () => {
  it("splits the shown text at emphasis and highlight edges; each run knows its offset and highlights", () => {
    const raw = "One *pretend* cloud drifts.";
    const runs = markRuns(raw, 0, [{ start: 4, end: 17, key: "h1" }]);
    expect(runs.map((r) => [r.at, r.text, r.em, r.keys])).toEqual([
      [0, "One ", false, []],
      [4, "pretend", true, ["h1"]],
      [11, " cloud", false, ["h1"]],
      [17, " drifts.", false, []],
    ]);
    expect(runs.map((r) => r.text).join("")).toBe(plainText(raw));
  });

  it("a paragraph further on in Read more counts from its own start (base)", () => {
    const runs = markRuns("Second para.", 20, [{ start: 27, end: 31, key: "h2" }]);
    expect(runs.map((r) => [r.at, r.text, r.keys])).toEqual([
      [20, "Second ", []],
      [27, "para", ["h2"]],
      [31, ".", []],
    ]);
  });
});

describe("the sealed entry's shape", () => {
  const entry: HighlightEntry = {
    v: 1,
    card: { id: "pretend-1", track: "", book: "", day: 1, chapter: 1, chapterTitle: "Pretend chapter", theme: "Pretend weather" },
    anchor: { field: "learn", exact: "pretend hill", prefix: "a ", suffix: ".", start: 2, end: 14 },
    note: "", createdAt: 1, at: 1, vid: "0a1b2c3d", seen: [],
  };
  it("is checked after opening", () => {
    expect(isHighlightEntry(entry)).toBe(true);
    expect(isHighlightEntry({ ...entry, deleted: true })).toBe(true);
    expect(isHighlightEntry({ ...entry, anchor: { ...entry.anchor, field: "answer" } })).toBe(false);
    expect(isHighlightEntry({ ...entry, anchor: { ...entry.anchor, exact: "" } })).toBe(false);
    expect(isHighlightEntry({ ...entry, note: 3 })).toBe(false);
    expect(isHighlightEntry({ ...entry, card: { ...entry.card, id: "" } })).toBe(false);
    expect(isHighlightEntry({ ...entry, seen: "x" })).toBe(false);
    expect(isHighlightEntry({ ...entry, v: 2 })).toBe(false);
  });
});

describe("which card a highlight is on (review M4)", () => {
  const set = parseCardFile(FAKE_CARD_TEXT_V2)!;
  const weather = set.cards[1]!;
  const text = cardFieldTexts(weather).learn;
  const s = text.indexOf("made-up hill");
  const anchor = describeAnchor("learn", text, s, s + 12)!;
  it("its own card by id", () => {
    expect(resolveCard({ id: weather.id, track: weather.track, day: 1 }, anchor, set.cards)).toEqual({ card: weather, at: { field: "learn", start: s, end: s + 12 } });
  });
  it("a re-import that changed the ids: the same book and day with the words", () => {
    expect(resolveCard({ id: "day-1", track: weather.track, day: 1 }, anchor, set.cards).card).toBe(weather);
  });
  it("another day's card is never taken; a card gone with no match is null", () => {
    expect(resolveCard({ id: "day-9", track: weather.track, day: 9 }, anchor, set.cards)).toEqual({ card: null, at: null });
  });
});
