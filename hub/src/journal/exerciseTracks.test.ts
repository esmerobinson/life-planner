import { describe, expect, it } from "vitest";
import { FAKE_CARD_FILE_KINDS, FAKE_CARD_FILE_TRACKS } from "../test/exerciseCards";
import {
  checkCardFile, emptyPart, partFilled, planExercise, readStoredSet, sequence, storedCards, storedTracks, trackerDaysFilled,
  trackTitle, upNext, type ExerciseMark,
} from "./exercise";

// Two books taken in turn (tracks) and the newer part kinds (table, scale, tracker, chain).
// Fictional fixtures only.

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const TRACKS = checkCardFile(FAKE_CARD_FILE_TRACKS)!;
const TODAY = "2026-11-02";
const ME = "device-mac-0001";
const done = (date: string, id: string, primary = true): ExerciseMark => ({ date, device: ME, id, done: true, primary });

describe("tracks (two books)", () => {
  it("reads the books; a card with no track is on the first; each book numbers its own days", () => {
    expect(TRACKS.tracks).toEqual(FAKE_CARD_FILE_TRACKS.tracks);
    expect(TRACKS.cards.find((c) => c.id === "first-002")!.track).toBe("first");
    expect(sequence(TRACKS.cards).map((c) => c.id)).toEqual(["first-001", "first-002", "first-003", "second-001", "second-002"]);
    expect(trackTitle(TRACKS, TRACKS.cards[3]!)).toBe("Pretend second workbook");
  });

  it("rejects an unknown track, a day twice in one book, bad track lists", () => {
    const f = clone(FAKE_CARD_FILE_TRACKS) as Record<string, unknown> & { cards: Record<string, unknown>[] };
    f.cards[0]!.track = "third";
    expect(checkCardFile(f)).toBeNull();
    const g = clone(FAKE_CARD_FILE_TRACKS) as Record<string, unknown> & { cards: Record<string, unknown>[] };
    g.cards[4]!.day = 1; // second book's day 1 twice
    expect(checkCardFile(g)).toBeNull();
    expect(checkCardFile({ ...clone(FAKE_CARD_FILE_TRACKS), tracks: [] })).toBeNull();
    expect(checkCardFile({ ...clone(FAKE_CARD_FILE_TRACKS), tracks: [{ id: "a", title: "A" }, { id: "a", title: "B" }] })).toBeNull();
  });

  it("without a tracks list, the books are the ones the cards name, in order", () => {
    const { tracks: _drop, ...rest } = clone(FAKE_CARD_FILE_TRACKS);
    const set = checkCardFile(rest)!;
    expect(set.tracks).toEqual([{ id: "first", title: "" }, { id: "second", title: "" }]);
  });

  it("stores and reads back the books with the cards", () => {
    const stored = storedCards(TRACKS);
    expect(stored[1]).toHaveProperty("track", "first");
    expect(readStoredSet(2, TRACKS.source, stored, storedTracks(TRACKS))).toEqual(TRACKS);
  });

  it("first day: the first book's Day 1; Do the next one alternates (second, first, second, first)", () => {
    const p = planExercise(TRACKS.cards, [], new Set(), TODAY, ME);
    expect(p.today.card.id).toBe("first-001");
    expect(p.queue.map((c) => c.id)).toEqual(["second-001", "first-002", "second-002", "first-003"]);
    expect(upNext(p, new Set())!.id).toBe("second-001");
  });

  it("the next day's card comes from the other book than the last one done", () => {
    expect(planExercise(TRACKS.cards, [done("2026-11-01", "first-001")], new Set(), TODAY, ME).today.card.id).toBe("second-001");
    const two = [done("2026-10-31", "first-001"), done("2026-11-01", "second-001")];
    expect(planExercise(TRACKS.cards, two, new Set(), TODAY, ME).today.card.id).toBe("first-002");
  });

  it("several in one day: the turn passes on from the last one done", () => {
    const day = [done("2026-11-01", "first-001"), done("2026-11-01", "second-001", false)];
    expect(planExercise(TRACKS.cards, day, new Set(), TODAY, ME).today.card.id).toBe("first-002");
  });

  it("a finished book is skipped: the other goes on", () => {
    const marks = [done("2026-10-28", "first-001"), done("2026-10-29", "second-001"), done("2026-10-30", "first-002"), done("2026-10-31", "second-002")];
    const p = planExercise(TRACKS.cards, marks, new Set(), TODAY, ME);
    expect(p.today.card.id).toBe("first-003");
    expect(p.queue[0]!.id).toBe("second-001"); // then a new round, still taking turns
  });
});

const KINDS = checkCardFile(FAKE_CARD_FILE_KINDS)!;
const [TABLE, SCALE, TRACKER, CHAIN] = KINDS.cards.map((c) => c.parts[0]!);

describe("newer part kinds", () => {
  it("reads table, scale, tracker and chain parts, and the format chip", () => {
    expect(TABLE).toEqual({ prompt: "Pretend feelings and what set them off", kind: "table", columns: ["Feeling", "Set off by"], rows: 2 });
    expect(SCALE).toMatchObject({ kind: "scale", min: 1, max: 5, minLabel: "Not at all", maxLabel: "Very" });
    expect(TRACKER).toEqual({ prompt: "Pretend sleep log", kind: "tracker", days: 3, fields: ["Hours", "Mood"] });
    expect(CHAIN).toEqual({ prompt: "A pretend chain of events", kind: "chain", steps: ["What set it off", "What I felt", "What I did"] });
    expect(KINDS.cards.map((c) => c.format)).toEqual(["Table", "Scale", "Tracker", "Chain"]);
  });

  it("rejects parts out of bounds", () => {
    const part = (p: Record<string, unknown>) => {
      const f = clone(FAKE_CARD_FILE_KINDS) as { cards: Record<string, unknown>[] };
      f.cards[0]!.parts = [p];
      return checkCardFile(f);
    };
    expect(part({ prompt: "P", kind: "table", columns: Array(7).fill("C"), rows: 1 })).toBeNull();
    expect(part({ prompt: "P", kind: "table", columns: ["x".repeat(41)], rows: 1 })).toBeNull();
    expect(part({ prompt: "P", kind: "table", columns: ["C"], rows: 21 })).toBeNull();
    expect(part({ prompt: "P", kind: "table", columns: ["C"], rows: 20 })).not.toBeNull();
    expect(part({ prompt: "P", kind: "scale", min: 0, max: 11 })).toBeNull();
    expect(part({ prompt: "P", kind: "scale", min: 3, max: 3 })).toBeNull();
    expect(part({ prompt: "P", kind: "scale", min: -5, max: 5 })).not.toBeNull();
    expect(part({ prompt: "P", kind: "tracker", days: 15, fields: ["F"] })).toBeNull();
    expect(part({ prompt: "P", kind: "tracker", days: 14, fields: ["A", "B", "C", "D", "E"] })).toBeNull();
    expect(part({ prompt: "P", kind: "chain", steps: Array(11).fill("S") })).toBeNull();
    expect(part({ prompt: "P", kind: "chain", steps: [] })).toBeNull();
  });

  it("filled: every table cell (or the first row for 'up to'), a scale value in range, every tracker day, every chain step", () => {
    expect(emptyPart(TABLE!)).toEqual([["", ""], ["", ""]]);
    expect(partFilled(TABLE!, [["a", "b"], ["c", ""]])).toBe(false);
    expect(partFilled(TABLE!, [["a", "b"], ["c", "d"]])).toBe(true);
    const upTo = { ...TABLE!, prompt: "Pretend: list up to two feelings" };
    expect(partFilled(upTo, [["a", "b"], ["", ""]])).toBe(true);
    expect(partFilled(upTo, [["a", "b"], ["c", ""]])).toBe(false);
    expect(partFilled(SCALE!, 0)).toBe(false);
    expect(partFilled(SCALE!, 5)).toBe(true);
    expect(trackerDaysFilled(TRACKER!, [["7", "ok"], ["", ""], ["6", "fine"]])).toBe(2);
    expect(partFilled(TRACKER!, [["7", "ok"], ["8", "good"], ["6", "fine"]])).toBe(true);
    expect(partFilled(CHAIN!, ["a", "b", ""])).toBe(false);
    expect(partFilled(CHAIN!, ["a", "b", "c"])).toBe(true);
  });
});

describe("a tracker card in progress", () => {
  const cards = KINDS.cards;
  const logged = (date: string, id: string): ExerciseMark => ({ date, device: ME, id, done: false, primary: false, logged: true });

  it("comes back as today's card until it is done", () => {
    const marks = [done("2026-10-30", "kinds-table"), done("2026-10-31", "kinds-scale"), logged("2026-11-01", "kinds-tracker")];
    const p = planExercise(cards, marks, new Set(), TODAY, ME);
    expect(p.today.card.id).toBe("kinds-tracker");
    expect([...p.inProgress]).toEqual(["kinds-tracker"]);
    expect(p.queue.map((c) => c.id)).toEqual(["kinds-chain"]); // Do the next one isn't blocked
  });

  it("once done, it is behind her", () => {
    const marks = [done("2026-10-30", "kinds-table"), logged("2026-10-31", "kinds-tracker"), done("2026-11-01", "kinds-tracker")];
    const p = planExercise(cards, marks, new Set(), TODAY, ME);
    expect(p.inProgress.size).toBe(0);
    expect(p.today.card.id).toBe("kinds-scale");
  });
});
