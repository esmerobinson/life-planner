import { describe, expect, it } from "vitest";
import { FAKE_CARD_FILE, FAKE_CARD_FILE_V2, FAKE_CARD_TEXT, FAKE_CARD_TEXT_V2 } from "../test/exerciseCards";
import {
  chapterLine, checkCardFile, emptyPart, legacyCardId, partFilled, mergeStars, moreParagraphs, parseCardFile, planExercise, readStoredSet,
  replacingRestarts, sequence, storedCards, upNext, type ExerciseMark,
} from "./exercise";

// The mental health exercise cards (exercise brief; Journal v2). Fictional fixtures only.

const clone = () => JSON.parse(FAKE_CARD_TEXT) as typeof FAKE_CARD_FILE & Record<string, unknown>;
const withCard = (patch: Record<string, unknown>, i = 0) => {
  const f = clone();
  (f.cards as Record<string, unknown>[])[i] = { ...f.cards[i], ...patch };
  return f;
};
const clone2 = () => JSON.parse(FAKE_CARD_TEXT_V2) as Record<string, unknown> & { cards: Record<string, unknown>[] };
const withCard2 = (patch: Record<string, unknown>, i = 1) => {
  const f = clone2();
  f.cards[i] = { ...f.cards[i], ...patch };
  return f;
};

describe("parseCardFile, version 1 (still accepted)", () => {
  it("reads the card file: source and cards in day order, each with the id day-N", () => {
    const f = clone();
    f.cards.reverse();
    const set = checkCardFile(f)!;
    expect(set.source).toBe(FAKE_CARD_FILE.source);
    expect(set.version).toBe(1);
    expect(set.cards.map((c) => c.day)).toEqual([1, 2, 3, 4, 5]);
    expect(set.cards.map((c) => c.id)).toEqual(["day-1", "day-2", "day-3", "day-4", "day-5"]);
    expect(set.cards[0]).toEqual({
      ...FAKE_CARD_FILE.cards[0], id: "day-1", chapter: null, chapterTitle: "", optional: false, more: "", sources: [], parts: [], example: "", bookExample: false, format: "", track: "",
      legacy: true,
    });
    expect(parseCardFile(FAKE_CARD_TEXT)).toEqual(checkCardFile(FAKE_CARD_FILE));
    expect(legacyCardId(4)).toBe("day-4");
  });

  it("rejects anything that isn't the card file", () => {
    expect(parseCardFile("not json")).toBeNull();
    expect(parseCardFile("[]")).toBeNull();
    expect(checkCardFile({ ...clone(), app: "other" })).toBeNull();
    expect(checkCardFile({ ...clone(), kind: "backup" })).toBeNull();
    expect(checkCardFile({ ...clone(), version: 3 })).toBeNull();
    expect(checkCardFile({ ...clone(), version: 2 })).toBeNull(); // v1 cards have no ids
    expect(checkCardFile({ ...clone(), source: 3 })).toBeNull();
    expect(checkCardFile({ ...clone(), cards: [] })).toBeNull();
    expect(checkCardFile({ ...clone(), cards: "x" })).toBeNull();
  });

  it("rejects the whole file for one bad card (types, lengths, days 1..1000 unique)", () => {
    expect(checkCardFile(withCard({ day: 0 }))).toBeNull();
    expect(checkCardFile(withCard({ day: 1001 }))).toBeNull();
    expect(checkCardFile(withCard({ day: 1.5 }))).toBeNull();
    expect(checkCardFile(withCard({ day: "1" }))).toBeNull();
    expect(checkCardFile(withCard({ day: 2 }))).toBeNull(); // day 2 twice
    expect(checkCardFile(withCard({ theme: 7 }))).toBeNull();
    expect(checkCardFile(withCard({ theme: "" }))).toBeNull();
    expect(checkCardFile(withCard({ learn: "x".repeat(2001) }))).toBeNull();
    expect(checkCardFile(withCard({ try: null }))).toBeNull();
    expect(checkCardFile(withCard({ book: ["p1"] }))).toBeNull();
    expect(checkCardFile(withCard({ skill: 4 }))).toBeNull();
    expect(checkCardFile(withCard({ session: "yes" }))).toBeNull();
    expect(checkCardFile({ ...clone(), source: "x".repeat(2001) })).toBeNull();
    expect(checkCardFile(withCard({ learn: "x".repeat(2000) }))).not.toBeNull();
  });

  it("an empty skill or book is fine; anything else on a card is dropped, not stored", () => {
    const set = checkCardFile(withCard({ skill: "", book: "", extra: "dropped" }))!;
    expect(set.cards[0]).toMatchObject({ skill: "", book: "" });
    expect(Object.keys(set.cards[0]!)).not.toContain("extra");
    expect(Object.keys(storedCards(set)[0]!).sort()).toEqual(["book", "day", "learn", "session", "skill", "theme", "try"]);
  });
});

describe("parseCardFile, version 2 (Journal v2)", () => {
  it("reads ids, chapters, optional cards (first), Read more and sources", () => {
    const set = parseCardFile(FAKE_CARD_TEXT_V2)!;
    expect(set.version).toBe(2);
    expect(set.cards.map((c) => c.id)).toEqual([
      "pretend-intro", "pretend-ch1-weather", "pretend-ch1-kettle", "pretend-ch2-pebbles", "pretend-ch2-lighthouse",
    ]);
    const [intro, weather, kettle] = set.cards;
    expect(intro).toMatchObject({ optional: true, day: null, theme: "Introduction", more: "", sources: [], legacy: false });
    expect(weather).toMatchObject({ day: 1, chapter: 1, chapterTitle: "Pretend basics", optional: false, legacy: false });
    expect(weather!.sources).toEqual(FAKE_CARD_FILE_V2.cards[1]!.sources);
    expect(kettle).toMatchObject({ more: "", sources: [], bookExample: true, example: expect.stringContaining("made-up example") });
    expect(kettle!.parts.map((p) => p.kind)).toEqual(["text", "list", "rating", "choice"]);
    expect(kettle!.parts[1]).toEqual({ prompt: "Three pretend places you feel it", kind: "list", count: 3 });
    expect(weather).toMatchObject({ parts: [], example: "", bookExample: false });
    expect(sequence(set.cards).map((c) => c.day)).toEqual([1, 2, 3, 4]);
  });

  it("the sequence is by day whatever the file's order (Chapter 1 is Day 1)", () => {
    const f = clone2();
    f.cards.reverse();
    expect(sequence(checkCardFile(f)!.cards).map((c) => c.id)).toEqual([
      "pretend-ch1-weather", "pretend-ch1-kettle", "pretend-ch2-pebbles", "pretend-ch2-lighthouse",
    ]);
  });

  it("rejects bad ids, days, chapters, Read more and sources", () => {
    expect(checkCardFile(withCard2({ id: "" }))).toBeNull();
    expect(checkCardFile(withCard2({ id: 5 }))).toBeNull();
    expect(checkCardFile(withCard2({ id: "x".repeat(101) }))).toBeNull();
    expect(checkCardFile(withCard2({ id: "pretend-ch1-kettle" }))).toBeNull(); // id twice
    expect(checkCardFile(withCard2({ day: null }))).toBeNull(); // only optional cards may have no day
    expect(checkCardFile(withCard2({ day: 2 }))).toBeNull(); // day 2 twice
    expect(checkCardFile(withCard2({ optional: "no" }))).toBeNull();
    expect(checkCardFile(withCard2({ chapter: "1" }))).toBeNull();
    expect(checkCardFile(withCard2({ chapter: -1 }))).toBeNull();
    expect(checkCardFile(withCard2({ chapterTitle: 1 }))).toBeNull();
    expect(checkCardFile(withCard2({ more: "x".repeat(6001) }))).toBeNull();
    expect(checkCardFile(withCard2({ more: 3 }))).toBeNull();
    expect(checkCardFile(withCard2({ more: "x".repeat(6000) }))).not.toBeNull();
    const src = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Pretend ${i}`, url: `https://example.org/${i}` }));
    expect(checkCardFile(withCard2({ sources: src(4) }))).not.toBeNull();
    expect(checkCardFile(withCard2({ sources: src(5) }))).toBeNull();
    expect(checkCardFile(withCard2({ sources: [{ title: "Pretend", url: "http://example.org" }] }))).toBeNull();
    expect(checkCardFile(withCard2({ sources: [{ title: "Pretend", url: "javascript:alert(1)" }] }))).toBeNull();
    expect(checkCardFile(withCard2({ sources: [{ title: "Pretend", url: "not a url" }] }))).toBeNull();
    expect(checkCardFile(withCard2({ sources: [{ title: "", url: "https://example.org" }] }))).toBeNull();
    expect(checkCardFile(withCard2({ sources: [{ title: "x".repeat(201), url: "https://example.org" }] }))).toBeNull();
    expect(checkCardFile(withCard2({ sources: "https://example.org" }))).toBeNull();
  });

  it("parts: up to 12; prompts up to 500; lists 1..30 lines; choices need options; example up to 1,500", () => {
    const part = (p: Record<string, unknown>) => withCard2({ parts: [p] });
    expect(checkCardFile(part({ prompt: "Pretend", kind: "text" }))).not.toBeNull();
    expect(checkCardFile(part({ prompt: "Pretend", kind: "list", count: 30 }))).not.toBeNull();
    expect(checkCardFile(part({ prompt: "Pretend", kind: "list", count: 31 }))).toBeNull();
    expect(checkCardFile(part({ prompt: "Pretend", kind: "list", count: 0 }))).toBeNull();
    expect(checkCardFile(part({ prompt: "Pretend", kind: "list" }))).toBeNull();
    expect(checkCardFile(part({ prompt: "Pretend", kind: "rating" }))).not.toBeNull();
    expect(checkCardFile(part({ prompt: "Pretend", kind: "choice", options: ["A", "B"] }))).not.toBeNull();
    expect(checkCardFile(part({ prompt: "Pretend", kind: "choice", options: [] }))).toBeNull();
    expect(checkCardFile(part({ prompt: "Pretend", kind: "choice", options: ["A", "A"] }))).toBeNull();
    expect(checkCardFile(part({ prompt: "Pretend", kind: "choice" }))).toBeNull();
    expect(checkCardFile(part({ prompt: "Pretend", kind: "drawing" }))).toBeNull();
    expect(checkCardFile(part({ prompt: "", kind: "text" }))).toBeNull();
    expect(checkCardFile(part({ prompt: "x".repeat(501), kind: "text" }))).toBeNull();
    expect(checkCardFile(withCard2({ parts: Array(13).fill({ prompt: "Pretend", kind: "text" }) }))).toBeNull();
    expect(checkCardFile(withCard2({ parts: Array(12).fill({ prompt: "Pretend", kind: "text" }) }))).not.toBeNull();
    expect(checkCardFile(withCard2({ example: "x".repeat(1501) }))).toBeNull();
    expect(checkCardFile(withCard2({ bookExample: "yes" }))).toBeNull();
    // A list part keeps only its count; a choice only its options.
    const set = checkCardFile(part({ prompt: "Pretend", kind: "list", count: 2, options: ["dropped"] }))!;
    expect(set.cards[1]!.parts).toEqual([{ prompt: "Pretend", kind: "list", count: 2 }]);
  });

  it("partFilled: text has words, a list has every line, a rating 0..10, a choice one of its options", () => {
    const [, , kettle] = parseCardFile(FAKE_CARD_TEXT_V2)!.cards;
    const [text, list, rating, choice] = kettle!.parts;
    expect(partFilled(text!, "  ")).toBe(false);
    expect(partFilled(text!, "Pretend")).toBe(true);
    expect(partFilled(list!, ["a", "b", ""])).toBe(false);
    expect(partFilled(list!, ["a", "b"])).toBe(false);
    expect(partFilled(list!, ["a", "b", "c"])).toBe(true);
    expect(partFilled(rating!, null)).toBe(false);
    expect(partFilled(rating!, 0)).toBe(true);
    expect(partFilled(rating!, 11)).toBe(false);
    expect(partFilled(choice!, "Tin")).toBe(true);
    expect(partFilled(choice!, "Steel")).toBe(false);
    expect(emptyPart(list!)).toEqual(["", "", ""]);
    expect(emptyPart(text!)).toBe("");
    expect(emptyPart(rating!)).toBeNull();
  });

  it("a file with only optional cards has nothing to do day by day, so it isn't read", () => {
    const f = clone2();
    f.cards = [f.cards[0]!];
    expect(checkCardFile(f)).toBeNull();
  });

  it("an optional card may keep a day; it still isn't in the sequence", () => {
    const set = checkCardFile(withCard2({ day: 9 }, 0))!;
    expect(set.cards[0]).toMatchObject({ optional: true, day: 9 });
    expect(sequence(set.cards).map((c) => c.day)).toEqual([1, 2, 3, 4]);
  });

  it("stored as the file's own shape and read back exactly; unknown fields make it unreadable", () => {
    const set = parseCardFile(FAKE_CARD_TEXT_V2)!;
    const stored = storedCards(set);
    expect(stored[0]).not.toHaveProperty("more");
    expect(stored[1]).toHaveProperty("sources");
    expect(readStoredSet(2, set.source, stored)).toEqual(set);
    expect(readStoredSet(2, set.source, [{ ...stored[1], extra: 1 }])).toBeNull();
    expect(readStoredSet(1, set.source, stored)).toBeNull();
    const v1 = checkCardFile(FAKE_CARD_FILE)!;
    expect(readStoredSet(1, v1.source, storedCards(v1))).toEqual(v1);
    expect(readStoredSet(1, "", [{ day: 1 }])).toBeNull();
  });

  it("the chapter line and Read more paragraphs", () => {
    const [intro, weather] = parseCardFile(FAKE_CARD_TEXT_V2)!.cards;
    expect(chapterLine(weather!)).toBe("Chapter 1 · Pretend basics");
    expect(chapterLine(intro!)).toBe("Chapter 0 · Before we begin");
    expect(chapterLine(checkCardFile(FAKE_CARD_FILE)!.cards[0]!)).toBe("");
    expect(moreParagraphs(weather!.more)).toEqual([
      "A made-up first paragraph about pretend clouds.",
      "A made-up second paragraph: clouds pass, hills stay.",
    ]);
    expect(moreParagraphs("")).toEqual([]);
  });
});

const set = checkCardFile(FAKE_CARD_FILE)!;
const cards = set.cards;
const TODAY = "2026-10-30";
const ME = "device-mac-0001";
const id = legacyCardId;
const done = (date: string, day: number, device = ME): ExerciseMark => ({ date, device, id: id(day), done: true, primary: true });
const shownMark = (date: string, day: number, device = ME): ExerciseMark => ({ date, device, id: id(day), done: false, primary: true });
const also = (date: string, day: number, device = ME): ExerciseMark => ({ date, device, id: id(day), done: true, primary: false });
const days = (ids: Iterable<string>) => [...ids].map((x) => Number(x.slice(4))).sort();

describe("planExercise", () => {
  it("first day: card 1, to be recorded as shown; the next one is card 2", () => {
    const p = planExercise(cards, [], new Set(), TODAY, ME);
    expect(p.today.card.day).toBe(1);
    expect(p.today.done).toBe(false);
    expect(p.record).toBe(true);
    expect(p.next.day).toBe(2);
    expect(p.round).toBe(1);
  });

  it("today's card is the lowest card not yet done, so a missed day skips nothing", () => {
    const marks = [done("2026-10-20", 1), done("2026-10-21", 2), done("2026-10-25", 4)];
    const p = planExercise(cards, marks, new Set(), TODAY, ME);
    expect(p.today.card.day).toBe(3);
    expect(p.next.day).toBe(5);
    expect(days(p.doneThisRound)).toEqual([1, 2, 4]);
  });

  it("done today: it stays today's card, done, and the next one is the following card", () => {
    const p = planExercise(cards, [done("2026-10-29", 1), done(TODAY, 2)], new Set(), TODAY, ME);
    expect(p.today).toMatchObject({ done: true });
    expect(p.today.card.day).toBe(2);
    expect(p.record).toBe(false);
    expect(p.next.day).toBe(3);
    expect(p.doneThisRound.has(id(2))).toBe(true);
  });

  it("once shown, a card stays today's card all day (even if an earlier tick syncs in later)", () => {
    const p = planExercise(cards, [shownMark(TODAY, 1), done("2026-10-29", 1, "phone-0001")], new Set(), TODAY, ME);
    expect(p.today.card.day).toBe(1);
    expect(p.today.done).toBe(false);
    expect(p.record).toBe(false);
  });

  it("any device's tick counts; another device's card for today is used too", () => {
    const theirs = shownMark(TODAY, 1, "phone-0001");
    expect(planExercise(cards, [theirs], new Set(), TODAY, ME)).toMatchObject({ record: false, today: { done: false } });
    const ticked = [shownMark(TODAY, 1), done(TODAY, 1, "phone-0001")];
    expect(planExercise(cards, ticked, new Set(), TODAY, ME).today).toMatchObject({ done: true, card: { day: 1 } });
  });

  it("a card no longer in the set is ignored", () => {
    const gone: ExerciseMark = { date: TODAY, device: ME, id: "gone", done: true, primary: true };
    const p = planExercise(cards, [gone, done("2026-10-01", 99)], new Set(), TODAY, ME);
    expect(p.today.card.day).toBe(1);
    expect(p.record).toBe(true);
  });

  it("after the last card, round 2 starts from card 1 with starred cards first", () => {
    const all = [1, 2, 3, 4, 5].map((d, i) => done(`2026-10-0${i + 1}`, d));
    const p = planExercise(cards, all, new Set(), TODAY, ME);
    expect(p.round).toBe(2);
    expect(p.today.card.day).toBe(1);
    expect(p.doneThisRound.size).toBe(0);
    const starred = planExercise(cards, all, new Set([id(4), id(2)]), TODAY, ME);
    expect(starred.today.card.day).toBe(2);
    expect(starred.next.day).toBe(4);
    const later = planExercise(cards, [...all, done("2026-10-10", 2), done("2026-10-11", 4)], new Set([id(4), id(2)]), TODAY, ME);
    expect(later.today.card.day).toBe(1);
    expect(later.next.day).toBe(3);
  });

  it("finishing the last card today keeps it as today's card; the next one is round 2's first", () => {
    const four = [1, 2, 3, 4].map((d, i) => done(`2026-10-0${i + 1}`, d));
    const p = planExercise(cards, [...four, done(TODAY, 5)], new Set([id(3)]), TODAY, ME);
    expect(p.round).toBe(1);
    expect(p.today).toMatchObject({ done: true, card: { day: 5 } });
    expect(p.next.day).toBe(3);
  });

  it("a card done twice in one round counts once", () => {
    const p = planExercise(cards, [done("2026-10-01", 1), done("2026-10-02", 1, "phone-0001")], new Set(), TODAY, ME);
    expect(p.today.card.day).toBe(2);
    expect(p.round).toBe(1);
  });

  it("optional cards are never today's card or in the queue", () => {
    const v2 = parseCardFile(FAKE_CARD_TEXT_V2)!.cards;
    const p = planExercise(v2, [], new Set(), TODAY, ME);
    expect(p.today.card.id).toBe("pretend-ch1-weather");
    expect(p.queue.map((c) => c.id)).toEqual(["pretend-ch1-kettle", "pretend-ch2-pebbles", "pretend-ch2-lighthouse"]);
  });
});

describe("Do the next one (several cards in one day)", () => {
  it("the queue is every card not yet done after today's; upNext skips cards already opened", () => {
    const p = planExercise(cards, [done("2026-10-29", 1), shownMark(TODAY, 2)], new Set(), TODAY, ME);
    expect(p.queue.map((c) => c.day)).toEqual([3, 4, 5]);
    expect(upNext(p, new Set())!.day).toBe(3);
    expect(upNext(p, new Set([id(3)]))!.day).toBe(4);
    expect(upNext(p, new Set([id(3), id(4), id(5)]))).toBeNull();
  });

  it("a further card done today counts today and leaves the queue; today's card stays today's", () => {
    const marks = [shownMark(TODAY, 1), also(TODAY, 2)];
    const p = planExercise(cards, marks, new Set(), TODAY, ME);
    expect(p.today).toMatchObject({ done: false, card: { day: 1 } });
    expect(days(p.doneToday)).toEqual([2]);
    expect(days(p.doneThisRound)).toEqual([2]);
    expect(p.queue.map((c) => c.day)).toEqual([3, 4, 5]);
  });

  it("tomorrow, every card done today is behind her", () => {
    const marks = [done("2026-10-29", 1), also("2026-10-29", 2), also("2026-10-29", 3)];
    const p = planExercise(cards, marks, new Set(), TODAY, ME);
    expect(p.today.card.day).toBe(4);
    expect(days(p.doneThisRound)).toEqual([1, 2, 3]);
  });

  it("only a one-card sequence has nothing next", () => {
    const one = [cards[0]!];
    expect(upNext(planExercise(one, [], new Set(), TODAY, ME), new Set())).toBeNull();
  });
});

describe("replacingRestarts", () => {
  const v1 = checkCardFile(FAKE_CARD_FILE)!;
  const v2 = parseCardFile(FAKE_CARD_TEXT_V2)!;
  it("true only when a card already done isn't in the new set", () => {
    expect(replacingRestarts([], v2)).toBe(false);
    expect(replacingRestarts([shownMark(TODAY, 1)], v2)).toBe(false);
    expect(replacingRestarts([done(TODAY, 1)], v2)).toBe(true);
    expect(replacingRestarts([done(TODAY, 1)], v1)).toBe(false);
    const byId: ExerciseMark = { date: TODAY, device: ME, id: "pretend-ch1-kettle", done: true, primary: true };
    expect(replacingRestarts([byId], v2)).toBe(false);
  });
});

describe("mergeStars", () => {
  it("each card takes its newest star mark from any device (so un-starring works too)", () => {
    const mac = [{ id: "a", on: true, at: 10 }, { id: "b", on: true, at: 10 }];
    const phone = [{ id: "b", on: false, at: 20 }, { id: "c", on: true, at: 5 }];
    expect([...mergeStars([mac, phone])].sort()).toEqual(["a", "c"]);
  });
});
