// The Mental health exercise and Daily check-in days that go to Together, with each day's note
// in two shapes (Together link brief §4, fix round 1). Read on this device through the journal
// repo, with the journal key, which never leaves it. Nothing sealed is sent; only text built here.
//
// - Exercise: a day where any card was ticked done.
//   - Titles-only: each card's title.
//   - With answers: each card's title, then each prompt she answered and her submitted answer
//     (never a draft), and a checklist's items with her choices.
// - v1 sends ONLY the exercise and check-in answers (Esme, 2026-11-06): "what I learned today"
//   and highlights are never read or sent here. They come in a later update (the earlier send
//   code is in git history: cb086e6, 8265e47).
// - Check-in: a day she finished ("Checked in for today").
//   - Titles-only: each question she answered.
//   - With answers: each of those questions, then her answer.
// - Only days from `since` (the sign-in day) and before `today` (which turns at 3am).
// - Never read or sent: morning pages (not even dates), photos, drafts, Notes to myself, stars,
//   "what I learned", highlights, the card file beyond the titles and prompts of cards she did.

import { db } from "../data/db";
import {
  answeredPrompts, listExerciseEntries, readCheckinDay, readExerciseCards, readExerciseProgress,
  type ExerciseResponse, type PartAnswer,
} from "../data/repo";
import type { ISODate } from "../domain/types";
import type { JournalKey } from "../journal/crypto";
import { trackTitle } from "../journal/exercise";
import { PROMPTS } from "../journal/prompts";
import { checkedIn } from "../journal/rows";
import { cardTitle } from "../ui/journal/ResponseView";

/** One day's note: titles or questions only, and with her answers. */
export interface DayNote {
  titles: string;
  full: string;
}

/**
 * One kind's days. `partial`: a day whose note was made from what could be read, but something of
 * it wouldn't open here; `unknown`: a day with no note at all because of that. Neither is ever
 * sent with answers; either can still be hidden (titles only) when ticked private (bug #59).
 */
export interface DayNotes {
  notes: Map<ISODate, DayNote>;
  unknown: Set<ISODate>;
  partial: Set<ISODate>;
}

export interface JournalDays {
  /** null: couldn't be read this time (nothing changes in Together). */
  exercise: DayNotes | null;
  checkin: DayNotes | null;
}

const filled = (s: unknown): s is string => typeof s === "string" && s.trim() !== "";
const clean = (s: string) => s.trim();

/** One part's answer as plain lines (a checklist with its items, a table's rows cell by cell). */
function partText(p: PartAnswer): string {
  const v = p.answer;
  if (v === null) return "";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return clean(v);
  if (v.every((x) => typeof x === "string")) return (v as string[]).filter(filled).map(clean).join("\n");
  return (v as string[][])
    .map((row) => {
      if (p.kind === "checklist") {
        const [item, choice, note] = row;
        if (!filled(choice) && !filled(note)) return "";
        return `${clean(item ?? "")}: ${filled(choice) ? clean(choice) : ""}${filled(note) ? ` (${clean(note)})` : ""}`;
      }
      return row.filter(filled).map(clean).join(" | ");
    })
    .filter((s) => s !== "")
    .join("\n");
}

/** Her answer to a card: its one text, or each part's prompt with her answer to it. */
export function answerText(r: Pick<ExerciseResponse, "text" | "parts">): string {
  const blocks = [clean(r.text)];
  for (const p of r.parts ?? []) {
    const a = partText(p);
    if (a) blocks.push(`${clean(p.prompt)}\n${a}`);
  }
  return blocks.filter((s) => s !== "").join("\n\n");
}

const PROMPT_TEXT = new Map(PROMPTS.map((p) => [p.id, p.text]));

export async function readJournalDays(jk: JournalKey, since: ISODate, today: ISODate): Promise<JournalDays> {
  const inWindow = (d: ISODate) => d >= since && d < today;
  return {
    exercise: await exerciseDays(jk, inWindow, today),
    checkin: await checkinDays(jk, since, today),
  };
}

async function exerciseDays(jk: JournalKey, inWindow: (d: ISODate) => boolean, today: ISODate): Promise<DayNotes | null> {
  const progress = await readExerciseProgress(jk);
  const cards = await readExerciseCards(jk);
  if (progress.unreadable > 0 || (cards.state !== "ok" && cards.state !== "none")) return null;
  const set = cards.state === "ok" ? cards.set : null;
  const ids = new Map<ISODate, string[]>();
  for (const m of progress.marks) {
    if (!m.done || !inWindow(m.date)) continue;
    const list = ids.get(m.date) ?? [];
    if (!list.includes(m.id)) list.push(m.id);
    ids.set(m.date, list);
  }
  const notes = new Map<ISODate, DayNote>();
  const unknown = new Set<ISODate>();
  const partial = new Set<ISODate>();
  if (ids.size === 0) return { notes, unknown, partial };
  const { entries, unreadable } = await listExerciseEntries(jk, today);
  if (unreadable > 0) return null;
  for (const [date, cardIds] of ids) {
    const titles: string[] = [];
    const full: string[] = [];
    for (const id of cardIds) {
      const card = set?.cards.find((c) => c.id === id);
      // Only what she submitted: a draft never goes.
      const said = entries.find((e) => e.date === date && e.id === id && e.saved && e.submitted);
      const title = card
        ? cardTitle(card, (set && trackTitle(set, card)) || undefined, true)
        : said
          ? cardTitle(said, undefined, false)
          : "An exercise card";
      titles.push(title);
      const words = said ? answerText(said) : "";
      full.push(words ? `${title}\n${words}` : title);
    }
    notes.set(date, { titles: titles.join("\n"), full: full.join("\n\n") });
  }
  return { notes, unknown, partial };
}

async function checkinDays(jk: JournalKey, since: ISODate, today: ISODate): Promise<DayNotes> {
  const notes = new Map<ISODate, DayNote>();
  const unknown = new Set<ISODate>();
  const partial = new Set<ISODate>();
  // Only the window's days are opened (the kind and date of a row are in clear).
  const rows = await db.journal.where("date").between(since, today, true, false).toArray();
  const dates = [...new Set(rows.filter((r) => r.kind === "set" || r.kind === "answer" || r.kind === "checkin").map((r) => r.date))].sort();
  for (const date of dates) {
    const day = await readCheckinDay(jk, date);
    if (day.unreadable > 0) {
      // Made from what opens (titles still go if it is ticked private); never sent with answers.
      if (!checkedIn(day)) {
        unknown.add(date);
        continue;
      }
      partial.add(date);
    }
    if (!checkedIn(day)) continue;
    const qs = answeredPrompts(day);
    notes.set(date, {
      titles: qs.map((id) => PROMPT_TEXT.get(id) ?? id).join("\n"),
      full: qs.map((id) => `${PROMPT_TEXT.get(id) ?? id}\n${clean(day.answers.get(id)?.answer ?? "")}`).join("\n\n"),
    });
  }
  return { notes, unknown, partial };
}
