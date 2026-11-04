// Keeps the Mac's pending reminders in step with the app: the schedule is recomputed and sent
// again on launch, after any local write or sync (Dexie's storagemutated), at local midnight,
// when the window comes back, and when the reminder settings change. Does nothing without the
// Mac app's bridge (bridge.ts).

import Dexie from "dexie";
import { useEffect } from "react";
import { db } from "../data/db";
import { listMorningDone, readCheckinDay } from "../data/repo";
import { loadJournalKey } from "../journal/keyStore";
import { checkedIn } from "../journal/rows";
import { hasNativeReminders, sendSchedule } from "./bridge";
import { computeSchedule, localNow, msToMidnight, type ScheduledReminder } from "./schedule";
import { loadReminderSettings, REMINDERS_CHANGED_EVENT } from "./settings";

/** Several writes in a row (a sync, typing) make one recompute: a technical wait, not a motion timing. */
const SETTLE_MS = 1500;

/**
 * Today's journal state, or nulls when this device can't read the journal (not set up or
 * locked): the schedule then keeps those reminders. Only whether it's done is read here.
 */
async function journalDone(today: string): Promise<{ morning: Set<string> | null; checkin: Set<string> | null }> {
  try {
    const jk = await loadJournalKey(db);
    if (!jk) return { morning: null, checkin: null };
    const [morning, day] = await Promise.all([listMorningDone(jk), readCheckinDay(jk, today)]);
    return { morning, checkin: new Set(checkedIn(day) ? [today] : []) };
  } catch {
    return { morning: null, checkin: null };
  }
}

/** This device's schedule from now, worked out from the database. */
export async function currentSchedule(clock: Date = new Date()): Promise<ScheduledReminder[]> {
  const now = localNow(clock);
  const [settings, items, journal] = await Promise.all([
    loadReminderSettings(),
    db.items.where("status").equals("open").toArray(),
    journalDone(now.date),
  ]);
  return computeSchedule({ settings, now, items, morningDone: journal.morning, checkinDone: journal.checkin });
}

let running: Promise<void> | null = null;
let again = false;

/** Recomputes and sends the schedule now (one at a time; a request meanwhile runs once more after). */
export function rescheduleReminders(): Promise<void> {
  if (!hasNativeReminders()) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      try {
        await sendSchedule(await currentSchedule());
      } catch (e) {
        console.warn("Reminders were not updated:", e);
      }
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Mounted once, in the app shell. */
export function useReminderScheduler(): void {
  useEffect(() => {
    if (!hasNativeReminders()) return;
    let settle: ReturnType<typeof setTimeout> | undefined;
    let midnight: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(settle);
      settle = setTimeout(() => void rescheduleReminders(), SETTLE_MS);
    };
    const armMidnight = () => {
      clearTimeout(midnight);
      midnight = setTimeout(() => {
        void rescheduleReminders();
        armMidnight();
      }, msToMidnight(new Date()));
    };
    const onVisible = () => {
      if (document.visibilityState !== "hidden") soon();
    };

    void rescheduleReminders();
    armMidnight();
    Dexie.on.storagemutated.subscribe(soon);
    window.addEventListener(REMINDERS_CHANGED_EVENT, soon);
    window.addEventListener("focus", soon);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(settle);
      clearTimeout(midnight);
      Dexie.on.storagemutated.unsubscribe(soon);
      window.removeEventListener(REMINDERS_CHANGED_EVENT, soon);
      window.removeEventListener("focus", soon);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
