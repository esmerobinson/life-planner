// The workbook bars and chapter map (journal v3; Esme's picks 2A + 2C, 2026-11-04): how far
// through each book she is, worked out from the imported cards and the progress marks (never
// hard-coded). Pure.

import { sequence, type CardSet, type ExercisePlan, type SequenceCard } from "./exercise";

/** Her two books' short names and what a step is called in each (the approved 2A wording). */
const KNOWN: Record<string, { name: string; tab: string; word: string }> = {
  bpd: { name: "BPD workbook", tab: "BPD", word: "Day" },
  dbt: { name: "DBT skills", tab: "DBT", word: "Card" },
};

export interface MapDot {
  card: SequenceCard;
  /** Done this round. */
  done: boolean;
  /** This book's next card (the violet outline). */
  now: boolean;
}

export interface MapChapter {
  /** The chapter's number (or its place, when the cards don't number it). */
  n: number;
  title: string;
  done: number;
  cards: MapDot[];
}

export interface Workbook {
  id: string;
  name: string;
  /** Its pill in the chapter map ("BPD" | "DBT"). */
  tab: string;
  /** "Day" or "Card". */
  word: string;
  total: number;
  /** Cards done this round. */
  done: number;
  /** The next card's number in the book ("Day N of 151"); the last one once all are done. */
  n: number;
  /** The next card's chapter ("Chapter C of 22"), or null when the cards have no chapters. */
  chapter: number | null;
  /** How many chapters the book has (0: none). */
  chapters: number;
  map: MapChapter[];
}

/** Each book with cards, in the file's order: its bar and its chapter map. */
export function workbooks(set: CardSet, plan: ExercisePlan): Workbook[] {
  const seq = sequence(set.cards);
  const out: Workbook[] = [];
  for (const t of set.tracks) {
    const cards = seq.filter((c) => c.track === t.id);
    if (cards.length === 0) continue;
    const isDone = (c: SequenceCard) => plan.doneThisRound.has(c.id);
    const next = cards.find((c) => !isDone(c)) ?? null;
    const at = next ?? cards[cards.length - 1]!;
    const groups = new Map<string, MapChapter>();
    for (const c of cards) {
      const key = c.chapter !== null ? `n${c.chapter}` : `t${c.chapterTitle}`;
      let ch = groups.get(key);
      if (!ch) groups.set(key, (ch = { n: c.chapter ?? groups.size + 1, title: c.chapterTitle, done: 0, cards: [] }));
      ch.cards.push({ card: c, done: isDone(c), now: c.id === next?.id });
      if (isDone(c)) ch.done++;
    }
    const map = [...groups.values()];
    const chaptered = cards.some((c) => c.chapter !== null);
    const known = KNOWN[t.id];
    const name = known?.name ?? (t.title || "Your cards");
    out.push({
      id: t.id,
      name,
      tab: known?.tab ?? name,
      word: known?.word ?? "Day",
      total: cards.length,
      done: cards.filter(isDone).length,
      n: at.day,
      chapter: chaptered ? (map.find((m) => m.cards.some((d) => d.card.id === at.id))?.n ?? null) : null,
      chapters: chaptered ? map.length : 0,
      map,
    });
  }
  return out;
}
