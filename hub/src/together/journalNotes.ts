// The Mental health exercise and Daily check-in days that go to Together, as the two parts of
// one challenge note per day (challenge brief, 2026-11-09). Read on this device through the
// journal repo, with the journal key, which never leaves it. Nothing sealed is sent; only text
// built here. Each part comes in two shapes: titles and questions only, and with her answers.
//
// The note (plain text; Together shows `## ` headings, `**…**` bold, "• " bullets and keeps line
// breaks; Esme's rulings, 2026-11-09):
//
//   <summary: the card title(s) · Check In>      (one line: Together's list shows only this)
//
//   ## Mental Health Exercise
//   <card title>
//
//   ## Research notes
//   • <her typed "What I learned" words, one bullet per line>
//   • <each highlight's words> — <her highlight note, if any>
//
//   **<question>**
//   <answer, written for its kind: see partAnswerText>
//
//   ## Check In
//   **<question>**
//   <answer>
//
// - Exercise: a day where any card was ticked done. Its questions are the prompts of the parts
//   she answered (a single-box card's answer has no question of its own: just the answer). Only
//   what she submitted, never a draft. Each part's answer is written using that card's part
//   definition (its columns, fields, steps and scale labels); without it, plainly. Research
//   notes: that day's "What I learned" (the newest version) and the highlights made that day and
//   not removed (bug #57: that day's own rows).
// - Check-in: a day she finished ("Checked in for today"): each question she answered.
// - Skipped: any question whose answer is "n/a" (any case or punctuation, Esme 2026-11-09), and
//   n/a lines or cells within an answer. A part with nothing left is left out; a day with nothing
//   sends nothing.
// - Every day before `today` (which turns at 3am), back to her first journal day (2026-11-08).
// - Never read or sent: morning pages (not even dates), photos, drafts, Notes to myself, Hard
//   moment, stars, the card file beyond the titles and part definitions (prompts, columns,
//   fields, steps, labels) of cards she did, learned words or highlights of a day with no card.

import { db } from "../data/db";
import {
  answeredPrompts, highlightRows, listExerciseEntries, readCheckinDay, readExerciseCards, readExerciseProgress, readLearned,
  unreadableExerciseDates,
  type ExerciseResponse, type PartAnswer,
} from "../data/repo";
import type { ISODate } from "../domain/types";
import type { JournalKey } from "../journal/crypto";
import { trackTitle, type CardPart } from "../journal/exercise";
import type { HighlightEntry } from "../journal/highlights";
import { PROMPTS } from "../journal/prompts";
import { checkedIn } from "../journal/rows";
import { cardTitle } from "../ui/journal/ResponseView";

/** The two parts of a day's note (named like the private ticks). */
export type Part = "exercise" | "checkin";
export const PARTS: Part[] = ["exercise", "checkin"];

/** The part headings in the note (Esme's layout and rulings, 2026-11-09). */
export const PART_HEADINGS: Record<Part, string> = {
  exercise: "## Mental Health Exercise",
  checkin: "## Check In",
};
export const RESEARCH_HEADING = "## Research notes";
/** A part's name in the summary line when it has no card titles. */
export const PART_SUMMARY: Record<Part, string> = { exercise: "Mental Health Exercise", checkin: "Check In" };
export const BULLET = "• ";
const SEP = " · ";

/** One day's part: titles and questions only, and with her answers ("" when nothing is left). */
export interface DayNote {
  titles: string;
  full: string;
  /** Its words in the summary line: the card titles (" · "), or "Check In". */
  summary: string;
  /**
   * When its research notes (learned words, highlights and their notes) last changed, epoch ms (0:
   * none). A change made after the day went waits 24 h after it too (review I2).
   */
  researchAt?: number;
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
/** Something written that isn't "n/a". */
const said = (s: unknown): s is string => filled(s) && !isNA(s);

/** A question and her answer (`q` is "" for a single-box card's answer). */
export interface QA {
  q: string;
  a: string;
}

/** Kept: answered, and not "n/a". */
const kept = (qas: QA[]) => qas.filter((x) => said(x.a)).map((x) => ({ q: clean(x.q), a: clean(x.a) }));

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

/** The exercise part's summary: the titles of the cards she did, joined with " · ". */
export const exerciseSummary = (titles: string[]): string => titles.map(oneLine).filter((t) => t !== "").join(SEP);

/**
 * The exercise part: its heading and titles, research notes, then each card's questions and
 * answers (under the card's title in bold when there are several cards).
 */
export function exerciseSection(cards: { title: string; qas: QA[] }[], research: string[], answers: boolean): string {
  if (cards.length === 0) return "";
  const blocks = [[PART_HEADINGS.exercise, ...cards.map((c) => clean(c.title))].join("\n")];
  if (answers && research.length > 0) blocks.push([RESEARCH_HEADING, ...research.map((b) => `${BULLET}${b}`)].join("\n"));
  const many = cards.filter((c) => kept(c.qas).length > 0).length > 1;
  for (const c of cards) {
    const qa = qaBlock(kept(c.qas), answers);
    if (qa) blocks.push(many ? `**${clean(c.title)}**\n${qa}` : qa);
  }
  return blocks.join("\n\n");
}

/** The check-in part: each question in bold with her answer below ("" when nothing is left). */
export function checkinSection(qas: QA[], answers: boolean): string {
  const qa = qaBlock(kept(qas), answers);
  return qa ? `${PART_HEADINGS.checkin}\n${qa}` : "";
}

/**
 * The day's note: one summary line (Together's list shows only the first line), then each part
 * that has something (an empty part is left out). "" when nothing is left.
 */
export function dayNote(parts: { summary: string; text: string }[]): string {
  const kept = parts.filter((p) => p.text.trim() !== "");
  if (kept.length === 0) return "";
  const summary = kept.map((p) => oneLine(p.summary)).filter((s) => s !== "").join(SEP);
  return [summary, ...kept.map((p) => p.text)].join("\n\n");
}

// ---- one part's answer, written for its kind (Esme, 2026-11-09) ---------------------------------

const bullets = (lines: string[]) => lines.map((l) => `${BULLET}${l}`).join("\n");
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : "")) : []);
const rowsOf = (v: unknown): string[][] => (Array.isArray(v) ? v.map(strs) : []);
/** "a: b" pairs with something said, joined with " · ". */
const pairs = (names: (string | undefined)[], values: string[]) =>
  values
    .map((v, i) => (said(v) ? (filled(names[i]) ? `${oneLine(names[i]!)}: ${oneLine(v)}` : oneLine(v)) : ""))
    .filter((s) => s !== "")
    .join(SEP);

/** As plain as before (no part definition to go by): every value, lines and cells as they are. */
function plainText(p: PartAnswer): string {
  const v = p.answer;
  if (v === null) return "";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return said(v) ? clean(v) : "";
  if (v.every((x) => typeof x === "string")) return (v as string[]).filter(said).map(clean).join("\n");
  return rowsOf(v)
    .map((row) => row.filter(said).map(oneLine).join(SEP))
    .filter((s) => s !== "")
    .join("\n");
}

/**
 * One part's answer as Together shows it, by its kind, using the card's part definition `def`
 * (columns, fields, steps, scale ends and labels) when there is one. Never drops what she wrote:
 * without a definition a part that needs one is written plainly. n/a lines and cells are left out.
 */
export function partAnswerText(p: PartAnswer, def?: CardPart): string {
  const v = p.answer;
  const d = def && def.kind === p.kind ? def : undefined;
  switch (p.kind) {
    case "text":
      return typeof v === "string" && said(v) ? clean(v) : "";
    case "list":
      return bullets(strs(v).filter(said).map(oneLine));
    case "rating":
      return num(v) ? `${v} out of ${num(d?.max) ? d!.max : 10}` : "";
    case "choice":
      return typeof v === "string" && said(v) ? clean(v) : "";
    case "scale": {
      if (!num(v)) return "";
      if (!d || !num(d.min) || !num(d.max)) return plainText(p);
      const ends = [filled(d.minLabel) ? `${d.min} = ${oneLine(d.minLabel)}` : "", filled(d.maxLabel) ? `${d.max} = ${oneLine(d.maxLabel)}` : ""].filter(Boolean);
      return `${v} out of ${d.max}${ends.length ? ` (${ends.join(", ")})` : ""}`;
    }
    case "chain": {
      if (!d?.steps) return bullets(strs(v).filter(said).map(oneLine));
      return bullets(strs(v).map((a, i) => (said(a) ? `${filled(d.steps![i]) ? `${oneLine(d.steps![i]!)}: ` : ""}${oneLine(a)}` : "")).filter((s) => s !== ""));
    }
    case "table":
      return bullets(rowsOf(v).map((row) => pairs(d?.columns ?? [], row)).filter((s) => s !== ""));
    case "tracker": {
      if (!d?.fields) return plainText(p);
      return bullets(
        rowsOf(v)
          .map((day, i) => {
            const got = pairs(d.fields!, day);
            return got ? `Day ${i + 1}: ${got}` : "";
          })
          .filter((s) => s !== ""),
      );
    }
    case "checklist":
      return bullets(
        rowsOf(v)
          .map(([item, choice, note]) => {
            if (!said(choice) && !said(note)) return "";
            return `${oneLine(item ?? "")}: ${[said(choice) ? oneLine(choice) : "", said(note) ? `(${oneLine(note)})` : ""].filter(Boolean).join(" ")}`;
          })
          .filter((s) => s !== ""),
      );
    default:
      return plainText(p);
  }
}

/** The card part an answer answers: the same prompt and kind (its own place first). */
function defFor(parts: CardPart[] | undefined, p: PartAnswer, i: number): CardPart | undefined {
  if (!parts) return undefined;
  const at = parts[i];
  if (at && at.prompt === p.prompt && at.kind === p.kind) return at;
  return parts.find((d) => d.prompt === p.prompt && d.kind === p.kind);
}

/** Her answer to a card: its one text (no question), then each part's prompt with her answer. */
export function cardQAs(r: Pick<ExerciseResponse, "text" | "parts">, defs?: CardPart[]): QA[] {
  const out: QA[] = [{ q: "", a: said(r.text) ? clean(r.text) : "" }];
  (r.parts ?? []).forEach((p, i) => out.push({ q: p.prompt, a: partAnswerText(p, defFor(defs, p, i)) }));
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
async function dayHighlights(
  jk: JournalKey, date: ISODate, twins: Map<string, ISODate>,
): Promise<{ list: { words: string; note: string }[]; partial: boolean; changedAt: number }> {
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
  // The newest version that adds or changes words (a removal only takes words out: not counted).
  const changedAt = Math.max(0, ...[...byHid.values()].flat().filter((v) => !v.deleted).map((v) => v.at));
  return { list: keep.map(({ words, note }) => ({ words, note })), partial, changedAt };
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
  if (cards.state !== "ok" && cards.state !== "none") return null;
  // A progress or response row that won't open here holds back only its own day (review M9).
  const bad = progress.unreadable > 0 ? await unreadableExerciseDates(jk) : new Set<ISODate>();
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
  const { entries, unreadable } = await listExerciseEntries(jk, today);
  if (unreadable > 0) for (const d of await unreadableExerciseDates(jk)) bad.add(d);
  for (const d of bad) if (d < today) unknown.add(d);
  if (ids.size === 0) return { notes, unknown, partial };
  const twins = await noteTwins(jk);
  for (const [date, cardIds] of ids) {
    if (bad.has(date)) continue;
    const learned = await readLearned(jk, date);
    const hl = await dayHighlights(jk, date, twins);
    if (learned.unreadable > 0 || hl.partial) partial.add(date);
    const done: { title: string; qas: QA[] }[] = [];
    for (const id of cardIds) {
      const card = set?.cards.find((c) => c.id === id);
      // Only what she submitted: a draft never goes.
      const entry = entries.find((e) => e.date === date && e.id === id && e.saved && e.submitted);
      const title = card
        ? cardTitle(card, (set && trackTitle(set, card)) || undefined, true)
        : entry
          ? cardTitle(entry, undefined, false)
          : "An exercise card";
      // Its parts written using the card's own part definitions (when the card is still here).
      done.push({ title, qas: entry ? cardQAs(entry, card?.parts) : [] });
    }
    const research = researchBullets(learned.text, hl.list);
    notes.set(date, {
      titles: exerciseSection(done, [], false),
      full: exerciseSection(done, research, true),
      summary: exerciseSummary(done.map((c) => c.title)),
      // (Learned words emptied or removed only take words out: not counted.)
      researchAt: Math.max(hl.changedAt, ...[learned, ...learned.others].filter((v) => v.text.trim() !== "").map((v) => v.at)),
    });
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
    notes.set(date, { titles, full: checkinSection(qas, true), summary: PART_SUMMARY.checkin });
  }
  return { notes, unknown, partial };
}
