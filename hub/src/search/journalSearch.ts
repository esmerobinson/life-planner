// Journal results for ⌘K search. Only with this device's CONFIRMED key, and only in memory:
// the opened text lives in the search pop-up while it is open and is dropped when it closes.
// Nothing is written (no index, no cache, no key bookkeeping). Morning pages under
// MORNING_LOCK_DAYS old are never even opened (they are locked by design).
// "Notes to myself" (a journal kind another branch adds) isn't on this branch yet; add it here
// when it lands.

import { listCheckinDays, listExerciseEntries, listReadBack, readMorningPage, type PartAnswer } from "../data/repo";
import { addDays } from "../domain/dates";
import type { ISODate } from "../domain/types";
import type { JournalKey } from "../journal/crypto";
import { PROMPT_BY_ID } from "../journal/prompts";
import { morningLocked, type JournalDoc } from "./search";

/** Every string in a part's answer (lists, tables, checklist rows), joined. */
function partText(parts: PartAnswer[] | null): string {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      if (v.trim()) out.push(v.trim());
    } else if (Array.isArray(v)) v.forEach(walk);
  };
  for (const p of parts ?? []) walk(p.answer);
  return out.join(" · ");
}

/**
 * The journal's searchable entries, opened with `jk`: check-in answers (with their question for
 * context), exercise responses up to today, and morning pages old enough for Read back. Rows
 * this key can't open are skipped by the repo, each on its own.
 */
export async function loadJournalDocs(jk: JournalKey, today: ISODate, signal?: AbortSignal): Promise<JournalDoc[]> {
  // Search closed (or the key changed): stop opening entries at the next step.
  const check = () => signal?.throwIfAborted();
  check();
  const docs: JournalDoc[] = [];
  const days = await listCheckinDays(jk);
  check();
  for (const day of days) {
    for (const [prompt, a] of day.answers) {
      if (!a.answer?.trim()) continue;
      docs.push({
        id: `checkin:${day.date}:${prompt}`,
        kind: "checkin",
        date: day.date,
        title: "Daily check-in",
        text: a.answer,
        ...(PROMPT_BY_ID.get(prompt) ? { context: PROMPT_BY_ID.get(prompt)!.text } : {}),
      });
    }
  }
  const { entries } = await listExerciseEntries(jk, addDays(today, 1));
  check();
  for (const e of entries) {
    const text = [e.text.trim(), partText(e.parts)].filter(Boolean).join(" · ");
    if (!text) continue;
    docs.push({
      id: `exercise:${e.date}:${e.id}`,
      kind: "exercise",
      date: e.date,
      title: `Mental health exercise${e.day !== null ? ` · Day ${e.day}` : ""}`,
      text,
    });
  }
  // The lock is checked on the row's clear date BEFORE anything is opened.
  for (const page of await listReadBack()) {
    if (morningLocked(page.date, today)) continue;
    check();
    const m = await readMorningPage(jk, page.id, today);
    if (m.state === "ok" && m.text.trim()) {
      docs.push({ id: `morning:${page.id}`, kind: "morning", date: page.date, title: "Morning pages", text: m.text });
    }
  }
  return docs;
}
