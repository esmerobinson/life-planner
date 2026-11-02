import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db } from "../data/db";
import { listJournalledDays, readExerciseProgress } from "../data/repo";
import type { GoalSources } from "../domain/goalCounts";
import type { ISODate, Item } from "../domain/types";
import { loadJournalKey } from "../journal/keyStore";
import { useDbChanges } from "./journal/useJournalKey";

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
    let days = new Set<ISODate>();
    let exercise: { date: ISODate; card: string }[] | null = null;
    try {
      days = await listJournalledDays();
    } catch {
      // Unreadable: nothing counts from the journal on this device.
    }
    try {
      const jk = await loadJournalKey(db);
      if (jk) {
        const { marks } = await readExerciseProgress(jk);
        exercise = marks.filter((m) => m.done || m.logged).map((m) => ({ date: m.date, card: m.id }));
      }
    } catch {
      exercise = null;
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
  useDbChanges(() => void load());

  return useMemo(
    () => ({
      sources: { journalDays: journal.days, exercise: journal.exercise, items },
      exerciseLocked: journal.loaded && journal.exercise === null,
      loaded: journal.loaded,
    }),
    [journal, items],
  );
}
