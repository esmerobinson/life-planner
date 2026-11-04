// Esme's Farm: what the journal tells the farm. Read ONLY with this device's confirmed journal
// key, through the journal repo's own key-gated reads; everything decrypted stays in memory and
// only dates and counts leave this file (never a word of what she wrote). Read only.

import { db } from "../data/db";
import { listCheckinDays, listMorningDone, readExerciseCards, readExerciseProgress } from "../data/repo";
import type { ISODate } from "../domain/types";
import { journalAad, openJson, type JournalKey } from "../journal/crypto";
import { countWords, ENTRY_CHECK, MORNING_WORDS } from "../journal/entries";
import { checkinDoneDays } from "../journal/rows";
import { workbookProgress, type JournalFacts } from "./earning";

/** Finished pages never change, so each page row is opened once per session. */
const shortCache = new Map<string, boolean>();

/** Days with a finished morning page shorter than the 1,000-word page ("short pages still count"). */
async function shortPageDays(jk: JournalKey): Promise<Set<ISODate>> {
  const out = new Set<ISODate>();
  for (const row of await db.journal.where("kind").equals("page").toArray()) {
    if (row.fp !== undefined && row.fp !== jk.fp) continue;
    const k = `${jk.fp}|${row.id}|${row.updatedAt ?? 0}`;
    let short = shortCache.get(k);
    if (short === undefined) {
      try {
        const v = await openJson(jk.key, row, journalAad(row.id));
        short = ENTRY_CHECK.page(v) && countWords(v.text) < MORNING_WORDS;
      } catch {
        short = false;
      }
      shortCache.set(k, short);
    }
    if (short) out.add(row.date);
  }
  return out;
}

export async function readJournalFacts(jk: JournalKey): Promise<JournalFacts> {
  const [morning, checkins, progress, cards, shortPages] = await Promise.all([
    listMorningDone(jk), listCheckinDays(jk), readExerciseProgress(jk), readExerciseCards(jk), shortPageDays(jk),
  ]);
  const books = cards.state === "ok" ? workbookProgress(cards.set.cards, cards.set.tracks, progress.marks) : null;
  return {
    morning,
    shortPages,
    checkins: checkinDoneDays(checkins),
    exercise: progress.marks.filter((m) => m.done || m.logged).map((m) => ({ date: m.date, card: m.id })),
    chapters: books?.chapters ?? [],
    workbooks: books?.workbooks ?? { dbt: null, bpd: null },
  };
}
