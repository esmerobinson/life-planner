import { describe, expect, it } from "vitest";
import { FAKE_CARD_FILE, FAKE_CARD_FILE_BOOKS } from "../test/exerciseCards";
import { checkCardFile, planExercise, type ExerciseMark } from "./exercise";
import { workbooks } from "./workbooks";

// The workbook bars and chapter map (journal v3, 2A + 2C): how far through each book, from the
// imported cards and the progress marks. Fictional cards only.

const BOOKS = checkCardFile(FAKE_CARD_FILE_BOOKS)!;
const TODAY = "2026-11-04";
const ME = "device-mac-0001";
const done = (date: string, id: string, primary = true): ExerciseMark => ({ date, device: ME, id, done: true, primary });
const plan = (marks: ExerciseMark[]) => planExercise(BOOKS.cards, marks, new Set(), TODAY, ME);

describe("workbooks", () => {
  it("nothing done: each book at its first card and first chapter; the optional card is not counted", () => {
    const [bpd, dbt] = workbooks(BOOKS, plan([]));
    expect(bpd).toMatchObject({ id: "bpd", name: "BPD workbook", word: "Day", total: 4, done: 0, n: 1, chapter: 1, chapters: 2 });
    expect(dbt).toMatchObject({ id: "dbt", name: "DBT skills", word: "Card", total: 3, done: 0, n: 1, chapter: 1, chapters: 2 });
    expect(bpd!.map.map((c) => [c.n, c.title, c.done, c.cards.length])).toEqual([[1, "Pretend meadow", 0, 2], [2, "Pretend river", 0, 2]]);
    expect(bpd!.map[0]!.cards.map((d) => [d.card.id, d.done, d.now])).toEqual([["b-001", false, true], ["b-002", false, false]]);
  });

  it("counts what is done (earlier days and today) and moves each book's next card and chapter on", () => {
    const marks = [done("2026-11-01", "b-001"), done("2026-11-02", "d-001"), done("2026-11-03", "b-002"), done(TODAY, "d-002")];
    const [bpd, dbt] = workbooks(BOOKS, plan(marks));
    expect(bpd).toMatchObject({ done: 2, n: 3, chapter: 2 });
    expect(dbt).toMatchObject({ done: 2, n: 3, chapter: 2 });
    expect(bpd!.map.map((c) => c.done)).toEqual([2, 0]);
    expect(dbt!.map[1]!.cards.map((d) => [d.card.id, d.done, d.now])).toEqual([["d-002", true, false], ["d-003", false, true]]);
  });

  it("a book with every card done: full, at its last card, nothing up next", () => {
    const marks = ["d-001", "d-002", "d-003"].map((id, i) => done(`2026-10-0${i + 1}`, id));
    const dbt = workbooks(BOOKS, plan(marks))[1]!;
    expect(dbt).toMatchObject({ done: 3, total: 3, n: 3, chapter: 2 });
    expect(dbt.map.flatMap((c) => c.cards).some((d) => d.now)).toBe(false);
  });

  it("a book with no cards has no bar; a single unnamed book is called by its word only", () => {
    const one = checkCardFile(FAKE_CARD_FILE)!;
    const books = workbooks(one, planExercise(one.cards, [], new Set(), TODAY, ME));
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({ name: "Your cards", word: "Day", total: 5, chapters: 0, chapter: null });
    const onlyFirst = checkCardFile({ ...FAKE_CARD_FILE_BOOKS, cards: FAKE_CARD_FILE_BOOKS.cards.filter((c) => c.id.startsWith("b-")) })!;
    expect(workbooks(onlyFirst, planExercise(onlyFirst.cards, [], new Set(), TODAY, ME)).map((b) => b.id)).toEqual(["bpd"]);
  });

  it("chapters numbered from where the book starts: 'Chapter C of N' never has C past N (review M9)", () => {
    const later = checkCardFile({
      ...FAKE_CARD_FILE_BOOKS,
      cards: FAKE_CARD_FILE_BOOKS.cards.map((c) => (c.chapter ? { ...c, chapter: c.chapter + 4 } : c)),
    })!;
    const [bpd] = workbooks(later, planExercise(later.cards, [], new Set(), TODAY, ME));
    expect(bpd).toMatchObject({ chapter: 5 });
    expect(bpd!.chapter!).toBeLessThanOrEqual(bpd!.chapters);
  });
});
