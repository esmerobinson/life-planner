import { describe, expect, it } from "vitest";
import { NOTE_GROUPS, todaysNotes } from "./notes";

// Notes to myself: the starter prompts (prompts only, never answers) and which notes come up
// to reread each day. Fictional notes only.

const note = (id: string, createdAt: number) => ({ id, createdAt });
const NOTES = ["a", "b", "c", "d", "e"].map((id, i) => note(id, i + 1));
const none = new Map<string, Set<string>>();

describe("starter prompts", () => {
  it("the nine groups, in her order, with exactly the prompts she gave (and no answers)", () => {
    expect(NOTE_GROUPS.map((g) => g.title)).toEqual([
      "Why bother", "Whose choice", "Fairness", "In a fight", "Feelings vs facts", "Fear of being left", "Self-worth", "After a slip", "Urges",
    ]);
    expect(NOTE_GROUPS.flatMap((g) => g.prompts)).toEqual([
      "Why should I care?", "Nothing changes anyway", "Doing the work will make a difference long term",
      "I'm only doing this because someone made me", "I don't need to do this",
      "This is unfair", "Why is it always me who has to work on things?",
      "He doesn't really love me", "This relationship is bad", "It's always been like this",
      "This feeling will last forever",
      "He's going to leave",
      "I'm too much", "I'm a bad person",
      "I've already messed up, so why try?",
      "I have to act on this right now",
    ]);
    for (const g of NOTE_GROUPS) expect(Object.keys(g).sort()).toEqual(["id", "prompts", "title"]);
  });
});

describe("todaysNotes", () => {
  it("none written: none; one: that one; more: two", () => {
    expect(todaysNotes([], none, "2026-11-04")).toEqual([]);
    expect(todaysNotes([note("a", 1)], none, "2026-11-04").map((n) => n.id)).toEqual(["a"]);
    expect(todaysNotes(NOTES, none, "2026-11-04")).toHaveLength(2);
  });

  it("rotates day by day, so every note comes up even if none is ticked", () => {
    const seen = new Set<string>();
    for (const day of ["2026-11-04", "2026-11-05", "2026-11-06"]) for (const n of todaysNotes(NOTES, none, day)) seen.add(n.id);
    expect(seen).toEqual(new Set(["a", "b", "c", "d", "e"]));
    expect(todaysNotes(NOTES, none, "2026-11-04")).not.toEqual(todaysNotes(NOTES, none, "2026-11-05"));
  });

  it("notes read lately go to the back; ticking today doesn't change today's pick", () => {
    const today = "2026-11-04";
    const before = todaysNotes(NOTES, none, today).map((n) => n.id);
    const readToday = new Map([[today, new Set(before)]]);
    expect(todaysNotes(NOTES, readToday, today).map((n) => n.id)).toEqual(before);
    const readYesterday = new Map([["2026-11-03", new Set(["a", "b", "c"])]]);
    expect(todaysNotes(NOTES, readYesterday, today).map((n) => n.id).sort()).toEqual(["d", "e"]);
  });
});
