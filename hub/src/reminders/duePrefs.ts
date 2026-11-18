// Due reminder settings (Due reminders, 2026-11-16): one synced row the sync Worker reads to
// put her reminders into Due (her partner's reminders app).
//
// Stored in the synced `prefs` table, row id "due", as PLAIN JSON (not encrypted): the Worker
// has to read it, and her motivation lines and the reminder titles go to Due's server anyway
// (the Reminders page says so). Never put anything from the journal here.
//
//   { id: "due", on, timeZone, plan, review, dueFirst, dueSecond, nudge, leadMinutes, lines, updatedAt }
//
// The Worker checks the same rules (sync/src/due/prefs.ts) and refuses a malformed row. A
// later version may add fields (allowed here). The table also holds Today's routine rows
// ("routine-step:…", "routine-tick:…", domain/dailyRoutine.ts) and Today's picks ("today-fill:…",
// domain/todayFill.ts), which the Worker stores without reading. A `prefs` row with any other id is for a later version (refused here, so sync keeps
// it in quarantine until an update reads it).
// No database import here, so the change tracker can use the validator without a cycle.

import { isRoutineRowId, validRoutineRow, type RoutineRow } from "../domain/dailyRoutine";
import { isTodayFillRowId, validTodayFillRow, type TodayFillRow } from "../domain/todayFill";

export const DUE_PREFS_ID = "due";
export const MAX_LINES = 50;
export const MAX_LINE_LENGTH = 120;
export const MAX_LEAD_MINUTES = 240;
export const DEFAULT_TIME_ZONE = "America/New_York";

export interface DuePrefs {
  /** Esmeworld puts reminders into Due. Off until she turns it on. */
  on: boolean;
  /** Her IANA time zone (her day still ends at 3am there). */
  timeZone: string;
  /** "Plan your day" ("HH:MM"). */
  plan: string;
  /** "Review your day". */
  review: string;
  /** Due today and not done: the first pass, then the second for what's still open. */
  dueFirst: string;
  dueSecond: string;
  /** The motivation nudge, if nothing has been ticked off by then. */
  nudge: string;
  /** Timed to-dos: minutes before. */
  leadMinutes: number;
  /** Her own motivation lines (one a day, in turn). */
  lines: string[];
}

export interface DuePrefsRow extends DuePrefs {
  id: typeof DUE_PREFS_ID;
  /** Sync stamp, set on every write by the change tracker. */
  updatedAt?: number;
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

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_KEYS = ["plan", "review", "dueFirst", "dueSecond", "nudge"] as const;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isLead = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_LEAD_MINUTES;
export const isLine = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && v.length <= MAX_LINE_LENGTH;

/** A time zone this device (and so the Worker) knows. */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz === "" || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Every row the synced `prefs` table holds: the Due settings, Today's routine and Today's picks. */
export type PrefsRow = DuePrefsRow | RoutineRow | TodayFillRow;

/** One prefs row is valid (sync, local writes): the "due" row, a routine row, or a today-fill row. */
export function validPrefs(r: unknown): r is PrefsRow {
  if (isObj(r) && isRoutineRowId(r.id)) return validRoutineRow(r);
  if (isObj(r) && isTodayFillRowId(r.id)) return validTodayFillRow(r);
  return validDuePrefs(r);
}

/** The "due" row is valid. */
export function validDuePrefs(r: unknown): r is DuePrefsRow {
  if (!isObj(r) || r.id !== DUE_PREFS_ID) return false;
  if (r.updatedAt !== undefined && !(typeof r.updatedAt === "number" && Number.isSafeInteger(r.updatedAt) && r.updatedAt >= 0)) return false;
  if (r.on !== undefined && typeof r.on !== "boolean") return false;
  if (r.timeZone !== undefined && !isTimeZone(r.timeZone)) return false;
  for (const k of TIME_KEYS) if (r[k] !== undefined && !(typeof r[k] === "string" && HHMM.test(r[k]))) return false;
  if (r.leadMinutes !== undefined && !isLead(r.leadMinutes)) return false;
  if (r.lines !== undefined && !(Array.isArray(r.lines) && r.lines.length <= MAX_LINES && r.lines.every(isLine))) return false;
  return true;
}

/** Settings as stored (anything), made whole: whatever is missing or broken is the default. */
export function normalizeDuePrefs(raw: unknown): DuePrefs {
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
    lines: Array.isArray(raw.lines) ? raw.lines.filter(isLine).slice(0, MAX_LINES) : [],
  };
}

/** The row to store for these settings (lines trimmed, blanks dropped). */
export function duePrefsRow(p: DuePrefs): DuePrefsRow {
  const n = normalizeDuePrefs({ ...p, lines: p.lines.map((l) => l.trim()).filter(isLine) });
  return { id: DUE_PREFS_ID, ...n };
}
