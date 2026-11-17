// Esme's Due reminder settings, as the Worker reads them.
//
// They live in the synced `prefs` table, row id "due", stored as plain JSON (NOT encrypted:
// the Worker has to read them, and the motivation lines are sent to Due's server anyway). The
// app writes the row from its Reminders page (hub/src/reminders/duePrefs.ts holds the same
// rules). Only the "due" row is checked here; other ids in `prefs` are for later versions.
//
//   { id: "due", updatedAt, on, timeZone, plan, review, dueFirst, dueSecond, nudge,
//     leadMinutes, lines }
//
// Writing (POST /v1/sync): a "due" row whose known fields are malformed is refused (400
// bad_change). Unknown fields are allowed, so a later app version can add some.
// Reading (the cron): anything missing or broken falls back to its default, except `on`,
// which must be exactly true for any reminder to be made.

import { DEFAULT_TIME_ZONE, HHMM, isTimeZone } from "./time";

export const PREFS_TABLE = "prefs";
export const DUE_PREFS_ID = "due";
export const MAX_LINES = 50;
export const MAX_LINE_LENGTH = 120;
export const MAX_LEAD_MINUTES = 240;

export interface DuePrefs {
  on: boolean;
  timeZone: string;
  /** "Plan your day". */
  plan: string;
  /** "Review your day". */
  review: string;
  /** Due today and not done: the first pass, and the second for what is still open. */
  dueFirst: string;
  dueSecond: string;
  /** The motivation nudge, if nothing has been ticked off by then. */
  nudge: string;
  /** Timed to-dos: how many minutes before. */
  leadMinutes: number;
  /** Her own motivation lines (one a day, in turn). */
  lines: string[];
}

export const DEFAULT_DUE_PREFS: DuePrefs = {
  on: false,
  timeZone: DEFAULT_TIME_ZONE,
  plan: "09:00",
  review: "21:00",
  dueFirst: "11:00",
  dueSecond: "17:00",
  nudge: "13:00",
  leadMinutes: 15,
  lines: [],
};

const TIME_KEYS = ["plan", "review", "dueFirst", "dueSecond", "nudge"] as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isLead = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_LEAD_MINUTES;
const isLine = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && v.length <= MAX_LINE_LENGTH;

/** A "due" prefs row is well formed (every known field, when present, is valid). */
export function validDuePrefsRow(r: unknown): boolean {
  if (!isObj(r) || r.id !== DUE_PREFS_ID) return false;
  if (r.on !== undefined && typeof r.on !== "boolean") return false;
  if (r.timeZone !== undefined && !isTimeZone(r.timeZone)) return false;
  for (const k of TIME_KEYS) if (r[k] !== undefined && !(typeof r[k] === "string" && HHMM.test(r[k]))) return false;
  if (r.leadMinutes !== undefined && !isLead(r.leadMinutes)) return false;
  if (r.lines !== undefined && !(Array.isArray(r.lines) && r.lines.length <= MAX_LINES && r.lines.every(isLine))) return false;
  return true;
}

/** The settings from a stored row (anything): whatever is missing or broken is the default; off unless `on` is true. */
export function readDuePrefs(raw: unknown): DuePrefs {
  const d = DEFAULT_DUE_PREFS;
  if (!isObj(raw)) return { ...d, lines: [] };
  const time = (k: (typeof TIME_KEYS)[number]) => (typeof raw[k] === "string" && HHMM.test(raw[k]) ? raw[k] : d[k]);
  return {
    on: raw.on === true,
    timeZone: isTimeZone(raw.timeZone) ? raw.timeZone : d.timeZone,
    plan: time("plan"),
    review: time("review"),
    dueFirst: time("dueFirst"),
    dueSecond: time("dueSecond"),
    nudge: time("nudge"),
    leadMinutes: isLead(raw.leadMinutes) ? raw.leadMinutes : d.leadMinutes,
    lines: Array.isArray(raw.lines) ? raw.lines.filter(isLine).slice(0, MAX_LINES).map((l) => l.trim()) : [],
  };
}
