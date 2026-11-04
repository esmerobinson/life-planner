// Esme's Farm: what the journal tells the farm. Read ONLY with this device's confirmed journal
// key; everything decrypted stays in memory, and only small derived facts are kept (a day, a
// done flag, a prompt's id, a word count's verdict): never a word of what she wrote.
//
// Incremental (review I2): each row is opened at most once per version. The derived fact is
// cached by key fingerprint, row id and updatedAt, so a sync, a draft autosave or a farm write
// never re-opens the journal; only a new or changed row is opened.

import { db } from "../data/db";
import { readExerciseCards } from "../data/repo";
import type { ISODate, JournalRow } from "../domain/types";
import { journalAad, openJson, type JournalKey } from "../journal/crypto";
import { countWords, ENTRY_CHECK, MORNING_WORDS } from "../journal/entries";
import { legacyCardId, type CardSet } from "../journal/exercise";
import { workbookProgress, type JournalFacts } from "./earning";

/** How many rows this module has decrypted (tests check that nothing is re-opened). */
let opens = 0;
export const journalOpenCount = (): number => opens;

type Fact =
  | { k: "page"; short: boolean }
  | { k: "morning"; done: boolean }
  | { k: "set"; prompts: string[] }
  | { k: "answer"; prompt: string; done: boolean }
  | { k: "checkin"; prompts: string[]; step: number; finished: boolean; answered: boolean[] }
  | { k: "exercise"; marks: { id: string; done: boolean; logged?: boolean }[] }
  | { k: "unreadable" };

const cache = new Map<string, Fact>();

async function factOf(jk: JournalKey, row: JournalRow): Promise<Fact> {
  const key = `${jk.fp}|${row.id}|${row.updatedAt ?? 0}|${row.iv}`;
  const had = cache.get(key);
  if (had) return had;
  let fact: Fact = { k: "unreadable" };
  if (row.fp === undefined || row.fp === jk.fp) {
    try {
      opens++;
      const v = await openJson(jk.key, row, journalAad(row.id));
      if (row.kind === "page" && ENTRY_CHECK.page(v)) fact = { k: "page", short: countWords(v.text) < MORNING_WORDS };
      else if (row.kind === "morning" && ENTRY_CHECK.morning(v)) fact = { k: "morning", done: v.pages > 0 || v.photos.length > 0 };
      else if (row.kind === "set" && ENTRY_CHECK.set(v)) fact = { k: "set", prompts: v.prompts };
      else if (row.kind === "answer" && ENTRY_CHECK.answer(v)) fact = { k: "answer", prompt: v.prompt, done: v.done };
      else if (row.kind === "checkin" && ENTRY_CHECK.checkin(v)) {
        fact = { k: "checkin", prompts: v.prompts, step: v.step, finished: v.finished, answered: v.answers.map((a) => a !== null) };
      } else if (row.kind === "exercise" && ENTRY_CHECK.exercise(v)) {
        fact = v.v === 1
          ? { k: "exercise", marks: [{ id: legacyCardId(v.day), done: v.done }] }
          : {
              k: "exercise",
              marks: [
                { id: v.id, done: v.done },
                ...v.also.map((id) => ({ id, done: true })),
                ...(v.logged ?? []).map((id) => ({ id, done: false, logged: true })),
              ],
            };
      }
    } catch {
      fact = { k: "unreadable" };
    }
  }
  cache.set(key, fact);
  return fact;
}

/** Checked in that day: it has questions and every one was moved past (journalRepo's rule). */
function checkedInDay(facts: Fact[]): boolean {
  let base: string[] | null = null;
  const done = new Map<string, boolean>();
  let legacy: Extract<Fact, { k: "checkin" }> | null = null;
  for (const f of facts) {
    if (f.k === "set") base = f.prompts;
    else if (f.k === "answer") done.set(f.prompt, (done.get(f.prompt) ?? false) || f.done);
    else if (f.k === "checkin") legacy = f;
  }
  if (legacy) {
    const l = legacy;
    l.prompts.forEach((p, i) => {
      if (done.has(p)) return;
      const reached = l.finished || i < l.step;
      if (reached || l.answered[i]) done.set(p, reached);
    });
  }
  const prompts = [...new Set([...(base ?? legacy?.prompts ?? []), ...done.keys()])];
  return prompts.length > 0 && prompts.every((p) => done.get(p) === true);
}

/** The cards are re-read only when their rows change (they're big; readExerciseCards caches chunks too). */
let cardsMemo: { sig: string; set: CardSet | null } | null = null;

export async function readJournalFacts(jk: JournalKey): Promise<JournalFacts> {
  const rows = await db.journal.where("kind").anyOf("page", "photo", "morning", "set", "answer", "checkin", "exercise").toArray();

  const morning = new Set<ISODate>();
  const shortPages = new Set<ISODate>();
  const checkinRows = new Map<ISODate, Fact[]>();
  const marks: { date: ISODate; id: string; done: boolean; logged?: boolean }[] = [];
  for (const row of rows) {
    if (row.kind === "photo") {
      morning.add(row.date);
      continue;
    }
    const f = await factOf(jk, row);
    if (row.kind === "page") {
      morning.add(row.date); // a finished page counts by its date, readable here or not
      if (f.k === "page" && f.short) shortPages.add(row.date);
    } else if (f.k === "morning" && f.done) morning.add(row.date);
    else if (f.k === "set" || f.k === "answer" || f.k === "checkin") checkinRows.set(row.date, [...(checkinRows.get(row.date) ?? []), f]);
    else if (f.k === "exercise") for (const m of f.marks) marks.push({ date: row.date, ...m });
  }
  const checkins = new Set([...checkinRows].filter(([, fs]) => checkedInDay(fs)).map(([d]) => d));

  const cardRows = await db.journal.where("kind").equals("cards").toArray();
  const sig = [jk.fp, ...cardRows.map((r) => `${r.id}|${r.updatedAt ?? 0}|${r.iv}`).sort()].join(";");
  if (!cardsMemo || cardsMemo.sig !== sig) {
    const cards = await readExerciseCards(jk);
    cardsMemo = { sig, set: cards.state === "ok" ? cards.set : null };
  }
  const books = cardsMemo.set ? workbookProgress(cardsMemo.set.cards, cardsMemo.set.tracks, marks) : null;
  return {
    morning,
    shortPages,
    checkins,
    exercise: marks.filter((m) => m.done || m.logged).map((m) => ({ date: m.date, card: m.id })),
    chapters: books?.chapters ?? [],
    workbooks: books?.workbooks ?? { dbt: null, bpd: null },
  };
}

/** Forget everything derived (e.g. the key changed). */
export function forgetJournalFacts(): void {
  cache.clear();
  cardsMemo = null;
}
