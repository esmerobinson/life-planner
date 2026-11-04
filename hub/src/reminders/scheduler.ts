// Keeps the Mac's pending reminders in step with the app: the schedule is recomputed on launch,
// after any local write or sync (Dexie's storagemutated), at the 3am day change, when the
// window comes back, and when the reminder settings change. It is sent only when it differs
// from the last one the Mac took. Does nothing without the Mac app's bridge (bridge.ts).

import Dexie from "dexie";
import { useEffect } from "react";
import { db } from "../data/db";
import { listMorningDone, readCheckinDay } from "../data/repo";
import { todayISO } from "../domain/dates";
import type { ISODate } from "../domain/types";
import { loadJournalKey } from "../journal/keyStore";
import { checkedIn } from "../journal/rows";
import { hasNativeReminders, sendSchedule } from "./bridge";
import { computeSchedule, localNow, msToDayChange, remindersOn, type ScheduleInput, type ScheduledReminder } from "./schedule";
import { loadReminderSettings, REMINDERS_CHANGED_EVENT } from "./settings";

/** Several writes in a row (a sync, typing) make one recompute: a technical wait, not a motion timing. */
const SETTLE_MS = 1500;

/**
 * Which app-days the journal things are done. Morning pages: finished pages and photos are
 * known from their rows' clear kind and date (no key needed; the key adds older-shape rows).
 * The check-in needs the key; without it (not set up, or locked) it's null and the schedule
 * keeps that reminder. Only "done or not" is read here.
 */
async function journalDone(today: ISODate): Promise<{ morning: Set<ISODate>; checkin: Set<ISODate> | null }> {
  const rows = await db.journal.where("kind").anyOf("page", "photo").toArray();
  const morning = new Set(rows.map((r) => r.date));
  try {
    const jk = await loadJournalKey(db);
    if (!jk) return { morning, checkin: null };
    const [all, day] = await Promise.all([listMorningDone(jk), readCheckinDay(jk, today)]);
    for (const d of all) morning.add(d);
    return { morning, checkin: new Set(checkedIn(day) ? [today] : []) };
  } catch {
    return { morning, checkin: null };
  }
}

/** Everything the schedule is worked out from, read from the database. */
async function scheduleInput(clock: Date): Promise<{ input: ScheduleInput; today: ISODate }> {
  const today = todayISO(clock); // the app-day (3am to 3am)
  const [settings, items, journal] = await Promise.all([
    loadReminderSettings(),
    db.items.where("status").equals("open").toArray(),
    journalDone(today),
  ]);
  return {
    today,
    input: { settings, now: localNow(clock), items, morningDone: journal.morning, checkinDone: journal.checkin },
  };
}

/** This device's schedule from now, worked out from the database. */
export async function currentSchedule(clock: Date = new Date()): Promise<ScheduledReminder[]> {
  return computeSchedule((await scheduleInput(clock)).input);
}

let running: Promise<void> | null = null;
let again = false;
let forceNext = false;
/** The last schedule the Mac took (while allowed), so an unchanged one isn't sent again. */
let lastSent = "";

/** Forgets what was last sent (tests). */
export function resetSchedulerForTests(): void {
  lastSent = "";
}

async function sendOnce(force: boolean): Promise<void> {
  const clock = new Date();
  const { input, today } = await scheduleInput(clock);
  const reminders = computeSchedule(input);
  // Today's reminders that still stand (done ones are gone): any other of today's already shown
  // in Notification Center is taken away.
  const keepToday = remindersOn(input, today).map((r) => r.id);
  const key = JSON.stringify([reminders, keepToday]);
  if (!force && key === lastSent) return;
  const reply = await sendSchedule(reminders, { today, keepToday });
  lastSent = reply?.status === "authorized" ? key : "";
}

/**
 * Recomputes the schedule and sends it if it changed (or always, with `force`). One at a time;
 * a request meanwhile runs once more after.
 */
export function rescheduleReminders(force = false): Promise<void> {
  if (!hasNativeReminders()) return Promise.resolve();
  if (force) forceNext = true;
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      const f = forceNext;
      forceNext = false;
      try {
        await sendOnce(f);
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
    let dayChange: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(settle);
      settle = setTimeout(() => void rescheduleReminders(), SETTLE_MS);
    };
    const armDayChange = () => {
      clearTimeout(dayChange);
      dayChange = setTimeout(() => {
        void rescheduleReminders();
        armDayChange();
      }, msToDayChange(new Date()));
    };
    const onVisible = () => {
      if (document.visibilityState !== "hidden") soon();
    };

    void rescheduleReminders(true);
    armDayChange();
    Dexie.on.storagemutated.subscribe(soon);
    window.addEventListener(REMINDERS_CHANGED_EVENT, soon);
    window.addEventListener("focus", soon);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(settle);
      clearTimeout(dayChange);
      Dexie.on.storagemutated.unsubscribe(soon);
      window.removeEventListener(REMINDERS_CHANGED_EVENT, soon);
      window.removeEventListener("focus", soon);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
