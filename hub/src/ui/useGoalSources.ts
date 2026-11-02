import Dexie from "dexie";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db } from "../data/db";
import { listCheckinDays, listJournalledDays, listMorningDone, readExerciseProgress } from "../data/repo";
import type { GoalSources } from "../domain/goalCounts";
import type { ISODate, Item } from "../domain/types";
import { loadJournalKey } from "../journal/keyStore";
import { journalRowDays } from "../journal/rows";

/** A changed-part key (`idb://<db>/<table>/<index>`) in the journal or the key's table. */
export const touchesJournal = (part: string): boolean => /^idb:\/\/[^/]+\/(journal|syncMeta)(\/|$)/.test(part);

/** What the goals count from, and what this device can't see. */
export interface GoalSourcesView {
  sources: GoalSources;
  /** The journal is locked here, so exercise cards can't be counted on this device. */
  exerciseLocked: boolean;
  /** The journal reads have answered (until then, counts from them are 0). */
  loaded: boolean;
}

/**
 * The goals' automatic sources (goals redesign): the journalled days from the journal rows'
 * clear dates (no key needed), and the exercise cards marked done, read through the journal
 * repo with this device's confirmed key (the same read the Home Exercise row ticks from).
 * Read only: goals never write journal rows. Re-read whenever the database changes.
 */
export function useGoalSources(items: readonly Item[]): GoalSourcesView {
  const [journal, setJournal] = useState<{
    days: Set<ISODate>;
    exercise: { date: ISODate; card: string }[] | null;
    loaded: boolean;
  }>({ days: new Set(), exercise: null, loaded: false });
  const latest = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    const id = ++latest.current;
    let days: Set<ISODate> | null = null;
    let exercise: { date: ISODate; card: string }[] | null = null;
    try {
      const jk = await loadJournalKey(db);
      if (jk) {
        // With the confirmed key: exactly the days the Journal rows tick (fix round 1, I1),
        // through the journal repo's key-gated reads, held in memory only.
        const [morning, checkins, progress] = await Promise.all([listMorningDone(jk), listCheckinDays(jk), readExerciseProgress(jk)]);
        days = journalRowDays(morning, checkins, progress.marks);
        exercise = progress.marks.filter((m) => m.done || m.logged).map((m) => ({ date: m.date, card: m.id }));
      }
    } catch {
      days = null;
      exercise = null;
    }
    if (days === null) {
      // Locked (or unreadable) here: the rows' clear dates (a page, a photo or an answer).
      try {
        days = await listJournalledDays();
      } catch {
        days = new Set(); // nothing counts from the journal on this device
      }
    }
    if (mounted.current && id === latest.current) setJournal({ days, exercise, loaded: true });
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);
  // Re-read only when the journal or the key could have changed (review M8): a to-do or sync
  // bookkeeping write never decrypts the exercise rows again. A change naming no tables re-reads.
  useEffect(() => {
    const onMutated = (parts: Record<string, unknown> | undefined) => {
      const keys = Object.keys(parts ?? {});
      if (keys.length === 0 || keys.some(touchesJournal)) void load();
    };
    Dexie.on.storagemutated.subscribe(onMutated);
    return () => Dexie.on.storagemutated.unsubscribe(onMutated);
  }, [load]);

  return useMemo(
    () => ({
      sources: { journalDays: journal.days, exercise: journal.exercise, items },
      exerciseLocked: journal.loaded && journal.exercise === null,
      loaded: journal.loaded,
    }),
    [journal, items],
  );
}
