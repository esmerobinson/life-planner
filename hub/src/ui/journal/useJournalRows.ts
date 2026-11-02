import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "../../data/db";
import { listCheckinDays, listMorningDone, readExerciseCards, readExerciseProgress } from "../../data/repo";
import type { ISODate } from "../../domain/types";
import { planExercise } from "../../journal/exercise";
import { loadJournalKey } from "../../journal/keyStore";
import { checkinDoneDays, exerciseDoneDays, rowStatus, type RowStatus } from "../../journal/rows";
import { loadTimeout } from "./loadTimeout";
import { useDbChanges } from "./useJournalKey";

export type JournalRowsView =
  | { state: "loading" }
  /** Not set up or not unlocked on this device (or unreadable): rows show with no ticks. */
  | { state: "locked" }
  /** A read failed or didn't answer within loadTimeout.ms: rows show with no ticks. */
  | { state: "error" }
  | {
      state: "ok";
      morning: RowStatus;
      checkin: RowStatus;
      exercise: RowStatus & { card: { day: number; theme: string } | null };
    };

/**
 * The Home Journal rows' ticks and streaks, read through the journal repo with the confirmed
 * key. Read only: it never writes (not even the key bookkeeping the Journal page does, nor
 * today's exercise card as shown). Re-read whenever the database changes.
 */
export function useJournalRows(today: ISODate): JournalRowsView {
  const [view, setView] = useState<JournalRowsView>({ state: "loading" });
  const latest = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    const id = ++latest.current;
    let next: JournalRowsView;
    try {
      const jk = await loadJournalKey(db);
      if (!jk) {
        next = { state: "locked" };
      } else {
        const [morning, checkins, progress, cards, device] = await Promise.all([
          listMorningDone(jk),
          listCheckinDays(jk),
          readExerciseProgress(jk),
          readExerciseCards(jk),
          db.syncMeta.get("deviceId"),
        ]);
        const deviceId = typeof device?.value === "string" ? device.value : "";
        const card =
          cards.state === "ok" ? planExercise(cards.set.cards, progress.marks, progress.starred, today, deviceId).today.card : null;
        next = {
          state: "ok",
          morning: rowStatus(morning, today),
          checkin: rowStatus(checkinDoneDays(checkins), today),
          exercise: { ...rowStatus(exerciseDoneDays(progress.marks), today), card: card && { day: card.day, theme: card.theme } },
        };
      }
    } catch {
      next = { state: "error" };
    }
    if (mounted.current && id === latest.current) setView(next);
  }, [today]);

  useEffect(() => {
    mounted.current = true;
    void load();
    // Never stuck on loading (2026-11-02): no answer in time shows the rows without ticks; a
    // late answer still ticks them.
    const timer = setTimeout(() => mounted.current && setView((v) => (v.state === "loading" ? { state: "error" } : v)), loadTimeout.ms);
    return () => {
      mounted.current = false;
      clearTimeout(timer);
    };
  }, [load]);
  useDbChanges(() => void load());
  return view;
}
