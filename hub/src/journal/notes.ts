// Notes to myself (journal v3; her partner's idea, Esme 2026-11-04): while steady, she writes
// answers to the thoughts that come up in hard moments, then rereads them, so her steady self
// has a voice. The starter prompts are only prompts: every answer is in her own words.

import type { ISODate } from "../domain/types";

export interface NoteGroup {
  id: string;
  title: string;
  prompts: string[];
}

/** Her nine groups, in her order, with the prompts exactly as she gave them. */
export const NOTE_GROUPS: NoteGroup[] = [
  { id: "why-bother", title: "Why bother", prompts: ["Why should I care?", "Nothing changes anyway", "Doing the work will make a difference long term"] },
  { id: "whose-choice", title: "Whose choice", prompts: ["I'm only doing this because someone made me", "I don't need to do this"] },
  { id: "fairness", title: "Fairness", prompts: ["This is unfair", "Why is it always me who has to work on things?"] },
  { id: "in-a-fight", title: "In a fight", prompts: ["He doesn't really love me", "This relationship is bad", "It's always been like this"] },
  { id: "feelings-facts", title: "Feelings vs facts", prompts: ["This feeling will last forever"] },
  { id: "being-left", title: "Fear of being left", prompts: ["He's going to leave"] },
  { id: "self-worth", title: "Self-worth", prompts: ["I'm too much", "I'm a bad person"] },
  { id: "after-a-slip", title: "After a slip", prompts: ["I've already messed up, so why try?"] },
  { id: "urges", title: "Urges", prompts: ["I have to act on this right now"] },
];

/** How many notes come up to reread each day (her ask: 1–2). */
export const NOTES_PER_DAY = 2;

/** Days since 1970-01-01 for a calendar date (no timezone shift). */
function dayNumber(date: ISODate): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(Date.UTC(y!, m! - 1, d!) / 86_400_000);
}

/**
 * Today's notes to reread: the ones read longest ago (never read first), and among those a
 * pick that moves on each day, so every note comes up in turn whether or not she ticks. Only
 * reads before today count, so ticking one today never swaps it out. No streaks, no counts.
 */
export function todaysNotes<T extends { id: string; createdAt: number }>(
  notes: readonly T[],
  readByDay: ReadonlyMap<ISODate, ReadonlySet<string>>,
  today: ISODate,
): T[] {
  if (notes.length === 0) return [];
  const last = new Map<string, ISODate>();
  for (const [date, ids] of readByDay) {
    if (date >= today) continue;
    for (const id of ids) if ((last.get(id) ?? "") < date) last.set(id, date);
  }
  const ordered = [...notes].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const shift = (dayNumber(today) * NOTES_PER_DAY) % ordered.length;
  const turn = (i: number) => (i - shift + ordered.length) % ordered.length;
  return ordered
    .map((n, i) => ({ n, last: last.get(n.id) ?? "", turn: turn(i) }))
    .sort((a, b) => a.last.localeCompare(b.last) || a.turn - b.turn)
    .slice(0, NOTES_PER_DAY)
    .map((x) => x.n);
}
