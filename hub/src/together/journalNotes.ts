// The Mental health exercise and Daily check-in days that go to Together, as the two parts of
// one challenge note per day (challenge brief, 2026-11-09). Read on this device through the
// journal repo, with the journal key, which never leaves it. Nothing sealed is sent; only text
// built here. Each part comes in two shapes: titles and questions only, and with her answers.
//
// The note (plain text; Together shows `**…**` as bold and keeps line breaks):
//
//   Mental Health Exercise
//   <card title>
//
//   Research notes
//   • <her typed "What I learned" words, one bullet per line>
//   • <each highlight's words> — <her highlight note, if any>
//
//   **<question>**
//   <answer>
//
//   Check In
//   **<question>**
//   <answer>
//
// - Exercise: a day where any card was ticked done. Its questions are the prompts of the parts
//   she answered (a single-box card's answer has no question of its own: just the answer). Only
//   what she submitted, never a draft. Research notes: that day's "What I learned" (the newest
//   version) and the highlights made that day and not removed (bug #57: that day's own rows).
// - Check-in: a day she finished ("Checked in for today"): each question she answered.
// - Skipped: any question whose answer is "n/a" (any case or punctuation, Esme 2026-11-09). A
//   part with nothing left is left out; a day with nothing sends nothing.
// - Every day before `today` (which turns at 3am), back to her first journal day (2026-11-08).
// - Never read or sent: morning pages (not even dates), photos, drafts, Notes to myself, Hard
//   moment, stars, the card file beyond the titles and prompts of cards she did, learned words or
//   highlights of a day with no card done.

import { db } from "../data/db";
import {
  answeredPrompts, highlightRows, listExerciseEntries, readCheckinDay, readExerciseCards, readExerciseProgress, readLearned,
  type ExerciseResponse, type PartAnswer,
} from "../data/repo";
import type { ISODate } from "../domain/types";
import type { JournalKey } from "../journal/crypto";
import { trackTitle } from "../journal/exercise";
import type { HighlightEntry } from "../journal/highlights";
import { PROMPTS } from "../journal/prompts";
import { checkedIn } from "../journal/rows";
import { cardTitle } from "../ui/journal/ResponseView";

/** The two parts of a day's note (named like the private ticks). */
export type Part = "exercise" | "checkin";
export const PARTS: Part[] = ["exercise", "checkin"];

/** The part headings in the note (Esme's layout, 2026-11-09). */
export const PART_HEADINGS: Record<Part, string> = {
  exercise: "Mental Health Exercise",
  checkin: "Check In",
};
export const RESEARCH_HEADING = "Research notes";
export const BULLET = "• ";

/** One day's part: titles and questions only, and with her answers ("" when nothing is left). */
export interface DayNote {
  titles: string;
  full: string;
}

/**
 * One part's days. `partial`: a day whose note was made from what could be read, but something of
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
  /** Her first exercise or check-in day found (undefined: none). */
  earliest?: ISODate;
}

const filled = (s: unknown): s is string => typeof s === "string" && s.trim() !== "";
const clean = (s: string) => s.trim();
/** One line (a bullet never breaks across lines). */
const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();

/** "n/a", "n.a", "na", "N/A." …: the question is left out with it (Esme, 2026-11-09). */
export const isNA = (answer: string): boolean => /^n\.?\s*\/?\s*a\.?$/i.test(answer.trim());

/** A question and her answer (`q` is "" for a single-box card's answer). */
export interface QA {
  q: string;
  a: string;
}

/** Kept: answered, and not "n/a". */
const kept = (qas: QA[]) => qas.filter((x) => filled(x.a) && !isNA(x.a)).map((x) => ({ q: clean(x.q), a: clean(x.a) }));

const qaText = (x: QA, answers: boolean) => (x.q ? (answers ? `**${x.q}**\n${x.a}` : `**${x.q}**`) : answers ? x.a : "");

/** A group of questions: each with its answer, blank lines between; or the questions alone. */
function qaBlock(qas: QA[], answers: boolean): string {
  return qas.map((x) => qaText(x, answers)).filter((s) => s !== "").join(answers ? "\n\n" : "\n");
}

/** The research notes' bullets: her words, one per line, then each highlight. */
export function researchBullets(learned: string, highlights: { words: string; note: string }[]): string[] {
  const own = learned.split(/[\r\n]+/).map(clean).filter((s) => s !== "");
  const hl = highlights
    .map((h) => ({ words: oneLine(h.words), note: oneLine(h.note) }))
    .filter((h) => h.words !== "")
    .map((h) => (h.note ? `${h.words} — ${h.note}` : h.words));
  return [...own, ...hl];
}

/** The exercise part: titles, research notes, then each card's questions and answers. */
export function exerciseSection(cards: { title: string; qas: QA[] }[], research: string[], answers: boolean): string {
  if (cards.length === 0) return "";
  const blocks = [[PART_HEADINGS.exercise, ...cards.map((c) => clean(c.title))].join("\n")];
  if (answers && research.length > 0) blocks.push([RESEARCH_HEADING, ...research.map((b) => `${BULLET}${b}`)].join("\n"));
  const many = cards.filter((c) => kept(c.qas).length > 0).length > 1;
  for (const c of cards) {
    const qa = qaBlock(kept(c.qas), answers);
    if (qa) blocks.push(many ? `${clean(c.title)}\n${qa}` : qa);
  }
  return blocks.join("\n\n");
}

/** The check-in part: each question in bold with her answer below ("" when nothing is left). */
export function checkinSection(qas: QA[], answers: boolean): string {
  const qa = qaBlock(kept(qas), answers);
  return qa ? `${PART_HEADINGS.checkin}\n${qa}` : "";
}

/** The day's note from its parts (an empty part is left out). */
export const dayNote = (parts: string[]): string => parts.filter((s) => s.trim() !== "").join("\n\n");

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

/** Her answer to a card: its one text (no question), then each part's prompt with her answer. */
export function cardQAs(r: Pick<ExerciseResponse, "text" | "parts">): QA[] {
  const out: QA[] = [{ q: "", a: clean(r.text) }];
  for (const p of r.parts ?? []) out.push({ q: p.prompt, a: partText(p) });
  return out;
}

const twinKey = (v: HighlightEntry) => `${v.at}|${v.note}`;

/**
 * For each note version written at once onto several days' highlight ids (the note box on the
 * same words highlighted on two days, shown as one: bug #57), the latest of those days.
 */
async function noteTwins(jk: JournalKey): Promise<Map<string, ISODate>> {
  const latest = new Map<string, ISODate>();
  for (const row of await db.journal.where("kind").equals("highlight").toArray()) {
    const o = await highlightRows.open(jk, row);
    if (o.state !== "ok" || o.entry.note.trim() === "") continue;
    const k = twinKey(o.entry);
    if ((latest.get(k) ?? "") < row.date) latest.set(k, row.date);
  }
  return latest;
}

/**
 * The day's highlights (bug #57): read per highlight id, from that day's own rows only, never
 * merged with the same words highlighted on another day. Each id's note is its newest version
 * still there with a note, unless that note was written at once onto a later day's highlight of
 * the same words too (then it belongs to that day, which she may have ticked private). A removed
 * one is left out. `partial`: a row of the day wouldn't open here.
 */
async function dayHighlights(jk: JournalKey, date: ISODate, twins: Map<string, ISODate>): Promise<{ list: { words: string; note: string }[]; partial: boolean }> {
  const byHid = new Map<string, HighlightEntry[]>();
  let partial = false;
  for (const row of await db.journal.where("date").equals(date).toArray()) {
    if (row.kind !== "highlight") continue;
    const o = await highlightRows.open(jk, row);
    if (o.state !== "ok") {
      partial = true;
      continue;
    }
    const rest = row.id.slice(`highlight:${row.date}:`.length);
    const hid = rest.slice(0, rest.indexOf("_"));
    byHid.set(hid, [...(byHid.get(hid) ?? []), o.entry]);
  }
  const keep: { hid: string; words: string; note: string; createdAt: number }[] = [];
  for (const [hid, versions] of byHid) {
    const heads = versions.filter((v) => !versions.some((w) => w !== v && w.seen.includes(v.vid)));
    const live = heads.filter((v) => !v.deleted).sort((a, b) => b.at - a.at || b.vid.localeCompare(a.vid));
    if (live.length === 0) continue;
    const top = live.find((v) => v.note.trim() !== "" && (twins.get(twinKey(v)) ?? date) === date);
    keep.push({ hid, words: live[0]!.anchor.exact, note: top?.note ?? "", createdAt: Math.min(...versions.map((v) => v.createdAt)) });
  }
  // A fixed order, so the note (and its hash) never changes by itself.
  keep.sort((a, b) => a.createdAt - b.createdAt || a.hid.localeCompare(b.hid));
  return { list: keep.map(({ words, note }) => ({ words, note })), partial };
}

const PROMPT_TEXT = new Map(PROMPTS.map((p) => [p.id, p.text]));

/** Every exercise and check-in day before `today`, from her first one. */
export async function readJournalDays(jk: JournalKey, today: ISODate): Promise<JournalDays> {
  const exercise = await exerciseDays(jk, today);
  const checkin = await checkinDays(jk, today);
  const dates = [exercise, checkin].flatMap((k) => (k ? [...k.notes.keys(), ...k.unknown, ...k.partial] : [])).sort();
  return { exercise, checkin, earliest: dates[0] };
}

async function exerciseDays(jk: JournalKey, today: ISODate): Promise<DayNotes | null> {
  const progress = await readExerciseProgress(jk);
  const cards = await readExerciseCards(jk);
  if (progress.unreadable > 0 || (cards.state !== "ok" && cards.state !== "none")) return null;
  const set = cards.state === "ok" ? cards.set : null;
  const ids = new Map<ISODate, string[]>();
  for (const m of progress.marks) {
    if (!m.done || !(m.date < today)) continue;
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
  const twins = await noteTwins(jk);
  for (const [date, cardIds] of ids) {
    const learned = await readLearned(jk, date);
    const hl = await dayHighlights(jk, date, twins);
    if (learned.unreadable > 0 || hl.partial) partial.add(date);
    const done: { title: string; qas: QA[] }[] = [];
    for (const id of cardIds) {
      const card = set?.cards.find((c) => c.id === id);
      // Only what she submitted: a draft never goes.
      const said = entries.find((e) => e.date === date && e.id === id && e.saved && e.submitted);
      const title = card
        ? cardTitle(card, (set && trackTitle(set, card)) || undefined, true)
        : said
          ? cardTitle(said, undefined, false)
          : "An exercise card";
      done.push({ title, qas: said ? cardQAs(said) : [] });
    }
    const research = researchBullets(learned.text, hl.list);
    notes.set(date, { titles: exerciseSection(done, [], false), full: exerciseSection(done, research, true) });
  }
  return { notes, unknown, partial };
}

async function checkinDays(jk: JournalKey, today: ISODate): Promise<DayNotes> {
  const notes = new Map<ISODate, DayNote>();
  const unknown = new Set<ISODate>();
  const partial = new Set<ISODate>();
  // Only days before today are opened (the kind and date of a row are in clear).
  const rows = await db.journal.where("date").below(today).toArray();
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
    const qas = answeredPrompts(day).map((id) => ({ q: PROMPT_TEXT.get(id) ?? id, a: day.answers.get(id)?.answer ?? "" }));
    const titles = checkinSection(qas, false);
    if (titles === "") continue; // every answer was "n/a": nothing of the check-in goes
    notes.set(date, { titles, full: checkinSection(qas, true) });
  }
  return { notes, unknown, partial };
}
