// "Remind me" on a to-do or habit (Esme, 20 Nov 2026): Item.remindAt, its own Due reminder on
// each day it is on Today and not done. Stored as "HH:MM" (24-hour, her time zone), or
// "sunset-N": N minutes before sunset where she is (the Reminders page's "Where you are").
// The sync Worker reads it with the same rules (sync/src/due/rules.ts parseRemindAt) and sends
// the reminder; a to-do with a time of its own keeps its timed alert instead.
// An older app version keeps the field as it is (its validator ignores fields it doesn't know,
// and it updates rows field by field).

import { timeLabel } from "./display";

/** The longest "Before sunset" (minutes); the Worker's MAX_BEFORE_SUNSET. */
export const MAX_BEFORE_SUNSET = 360;
const REMIND_AT = /^(?:(([01]\d|2[0-3]):[0-5]\d)|sunset-(\d{1,3}))$/;

export type RemindAt = { time: string } | { beforeSunset: number };

/** A remindAt as stored: a time, or minutes before sunset; null when it isn't one. */
export function parseRemindAt(v: unknown): RemindAt | null {
  if (typeof v !== "string") return null;
  const m = REMIND_AT.exec(v);
  if (!m) return null;
  if (m[1]) return { time: m[1] };
  const n = Number(m[3]);
  return n <= MAX_BEFORE_SUNSET ? { beforeSunset: n } : null;
}

export const isRemindAt = (v: unknown): v is string => parseRemindAt(v) !== null;

export const formatRemindAt = (r: RemindAt): string => ("time" in r ? r.time : `sunset-${r.beforeSunset}`);

/** PROVISIONAL WORDING (hers and Design's to change), all in one place. */
export const REMIND_WORDS = {
  key: "Remind me",
  off: "Off",
  atTime: "At a time",
  beforeSunset: "Before sunset",
  atLabel: "Remind me at",
  minutesLabel: "Minutes before sunset",
  minutesSuffix: "min before sunset",
  beforeSunsetLine: (m: number) => `${m} min before sunset`,
  badMinutes: `Before sunset is a whole number of minutes, 0 to ${MAX_BEFORE_SUNSET}.`,
  needTime: "Pick a time for Remind me, or set it to Off.",
} as const;

/** What the panel shows: "Off", "10:00pm" or "90 min before sunset". */
export function remindAtLabel(v: string | undefined): string {
  const r = parseRemindAt(v);
  if (!r) return REMIND_WORDS.off;
  return "time" in r ? timeLabel(r.time) : REMIND_WORDS.beforeSunsetLine(r.beforeSunset);
}
