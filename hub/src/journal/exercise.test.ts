import { describe, expect, it } from "vitest";
import { FAKE_CARD_FILE, FAKE_CARD_TEXT } from "../test/exerciseCards";
import { checkCardFile, mergeStars, parseCardFile, planExercise, validCardSet, type ExerciseMark } from "./exercise";

// The mental health exercise cards (exercise brief). Fictional fixture only.

const clone = () => JSON.parse(FAKE_CARD_TEXT) as typeof FAKE_CARD_FILE & Record<string, unknown>;
const withCard = (patch: Record<string, unknown>, i = 0) => {
  const f = clone();
  (f.cards as Record<string, unknown>[])[i] = { ...f.cards[i], ...patch };
  return f;
};

describe("parseCardFile", () => {
  it("reads the card file: source and cards in day order", () => {
    const f = clone();
    f.cards.reverse();
    const set = checkCardFile(f)!;
    expect(set.source).toBe(FAKE_CARD_FILE.source);
    expect(set.cards.map((c) => c.day)).toEqual([1, 2, 3, 4, 5]);
    expect(set.cards[0]).toEqual(FAKE_CARD_FILE.cards[0]);
    expect(parseCardFile(FAKE_CARD_TEXT)).toEqual(checkCardFile(FAKE_CARD_FILE));
    expect(validCardSet(set)).toBe(true);
  });

  it("rejects anything that isn't the card file", () => {
    expect(parseCardFile("not json")).toBeNull();
    expect(parseCardFile("[]")).toBeNull();
    expect(checkCardFile({ ...clone(), app: "other" })).toBeNull();
    expect(checkCardFile({ ...clone(), kind: "backup" })).toBeNull();
    expect(checkCardFile({ ...clone(), version: 2 })).toBeNull();
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
    expect(set.cards[0]).toEqual({ ...FAKE_CARD_FILE.cards[0], skill: "", book: "" });
    expect(Object.keys(set.cards[0]!)).not.toContain("extra");
  });
});

const set = checkCardFile(FAKE_CARD_FILE)!;
const cards = set.cards;
const TODAY = "2026-10-30";
const ME = "device-mac-0001";
const done = (date: string, day: number, device = ME): ExerciseMark => ({ date, device, day, done: true });

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
    expect([...p.doneThisRound].sort()).toEqual([1, 2, 4]);
  });

  it("ticked today: it stays today's card, done, and the next one is the following card", () => {
    const p = planExercise(cards, [done("2026-10-29", 1), done(TODAY, 2)], new Set(), TODAY, ME);
    expect(p.today).toMatchObject({ done: true });
    expect(p.today.card.day).toBe(2);
    expect(p.record).toBe(false);
    expect(p.next.day).toBe(3);
    expect(p.doneThisRound.has(2)).toBe(true);
  });

  it("once shown, a card stays today's card all day (even if an earlier tick syncs in later)", () => {
    const shown: ExerciseMark = { date: TODAY, device: ME, day: 1, done: false };
    const p = planExercise(cards, [shown, done("2026-10-29", 1, "phone-0001")], new Set(), TODAY, ME);
    expect(p.today.card.day).toBe(1);
    expect(p.today.done).toBe(false);
    expect(p.record).toBe(false);
  });

  it("any device's tick counts; another device's card for today is used too", () => {
    const theirs: ExerciseMark = { date: TODAY, device: "phone-0001", day: 1, done: false };
    expect(planExercise(cards, [theirs], new Set(), TODAY, ME)).toMatchObject({ record: false, today: { done: false } });
    const ticked = [{ date: TODAY, device: ME, day: 1, done: false }, done(TODAY, 1, "phone-0001")];
    expect(planExercise(cards, ticked, new Set(), TODAY, ME).today).toMatchObject({ done: true, card: { day: 1 } });
  });

  it("a card no longer in the set is ignored", () => {
    const p = planExercise(cards, [{ date: TODAY, device: ME, day: 77, done: true }, done("2026-10-01", 99)], new Set(), TODAY, ME);
    expect(p.today.card.day).toBe(1);
    expect(p.record).toBe(true);
  });

  it("after the last card, round 2 starts from card 1 with starred cards first", () => {
    const all = [1, 2, 3, 4, 5].map((d, i) => done(`2026-10-0${i + 1}`, d));
    const p = planExercise(cards, all, new Set(), TODAY, ME);
    expect(p.round).toBe(2);
    expect(p.today.card.day).toBe(1);
    expect(p.doneThisRound.size).toBe(0);
    const starred = planExercise(cards, all, new Set([4, 2]), TODAY, ME);
    expect(starred.today.card.day).toBe(2);
    expect(starred.next.day).toBe(4);
    const later = planExercise(cards, [...all, done("2026-10-10", 2), done("2026-10-11", 4)], new Set([4, 2]), TODAY, ME);
    expect(later.today.card.day).toBe(1);
    expect(later.next.day).toBe(3);
  });

  it("ticking the last card today keeps it as today's card; the next one is round 2's first", () => {
    const four = [1, 2, 3, 4].map((d, i) => done(`2026-10-0${i + 1}`, d));
    const p = planExercise(cards, [...four, done(TODAY, 5)], new Set([3]), TODAY, ME);
    expect(p.round).toBe(1);
    expect(p.today).toMatchObject({ done: true, card: { day: 5 } });
    expect(p.next.day).toBe(3);
  });

  it("a card ticked twice in one round counts once", () => {
    const p = planExercise(cards, [done("2026-10-01", 1), done("2026-10-02", 1, "phone-0001")], new Set(), TODAY, ME);
    expect(p.today.card.day).toBe(2);
    expect(p.round).toBe(1);
  });
});

describe("mergeStars", () => {
  it("each card takes its newest star mark from any device (so un-starring works too)", () => {
    const mac = [{ day: 1, on: true, at: 10 }, { day: 2, on: true, at: 10 }];
    const phone = [{ day: 2, on: false, at: 20 }, { day: 3, on: true, at: 5 }];
    expect([...mergeStars([mac, phone])].sort()).toEqual([1, 3]);
  });
});
