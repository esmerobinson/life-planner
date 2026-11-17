// Wall-clock helpers for Esme's own time zone (Due reminders). The Worker runs in UTC; every
// "today" and every "HH:MM" here is in the time zone she chose in Esmeworld.
//
// Her day ends at 3am (hub/src/domain/dates.ts DAY_ENDS_AT_HOUR, her choice 2026-11-04): a
// moment before 3am belongs to the previous day. A settings time before 03:00 therefore goes
// off after midnight, at the end of its day (as hub/src/reminders/schedule.ts wallTime).

export const DAY_ENDS_AT_HOUR = 3;
export const DEFAULT_TIME_ZONE = "America/New_York";
/** Due reads a dueAt without an offset in US Eastern time (due-integration.md). */
export const DUE_DEFAULT_ZONE = "America/New_York";

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const DAY_CHANGE = `${String(DAY_ENDS_AT_HOUR).padStart(2, "0")}:00`;
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** True when the runtime knows this IANA time zone. */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

export interface WallClock {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
}

/** The wall-clock date and time of an instant in `tz`. */
export function wallClock(ms: number, tz: string): WallClock {
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) parts[p.type] = p.value;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const utcOf = (date: string, time: string) =>
  Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), Number(time.slice(0, 2)), Number(time.slice(3, 5)));

/** Minutes `tz` is ahead of UTC at an instant (New York in winter: -300). */
export function offsetMinutes(ms: number, tz: string): number {
  const w = wallClock(ms, tz);
  return Math.round((utcOf(w.date, w.time) - Math.floor(ms / MINUTE_MS) * MINUTE_MS) / MINUTE_MS);
}

/** The instant of a wall-clock date and time in `tz` (a time skipped by a clock change lands just after it). */
export function instantOf(date: string, time: string, tz: string): number {
  const guess = utcOf(date, time);
  const first = guess - offsetMinutes(guess, tz) * MINUTE_MS;
  return guess - offsetMinutes(first, tz) * MINUTE_MS;
}

export function addDays(date: string, n: number): string {
  return new Date(utcOf(date, "00:00") + n * DAY_MS).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): (typeof WEEKDAYS)[number] {
  return WEEKDAYS[new Date(utcOf(date, "00:00")).getUTCDay()]!;
}

/** Esme's "today" at an instant: her local date, the day before until 3am. */
export function appDay(ms: number, tz: string): string {
  const w = wallClock(ms, tz);
  return w.time < DAY_CHANGE ? addDays(w.date, -1) : w.date;
}

/** The instant a settings time goes off on app-day `day` (before 3am: after midnight). */
export function settingsInstant(day: string, time: string, tz: string): number {
  return instantOf(time < DAY_CHANGE ? addDays(day, 1) : day, time, tz);
}

/** ISO-8601 with the zone's offset at that instant, to the minute: "2026-11-16T15:00:00-05:00". */
export function isoInZone(ms: number, tz: string): string {
  const w = wallClock(ms, tz);
  const off = offsetMinutes(ms, tz);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${w.date}T${w.time}:00${sign}${hh}:${mm}`;
}

const LOCAL_ISO = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2}(\.\d+)?)?$/;

/**
 * The instant of a dueAt as Due holds it: with a zone (Z or an offset) as written; without one
 * in Due's default zone (US Eastern). NaN when it can't be read.
 */
export function parseDueAt(s: unknown): number {
  if (typeof s !== "string") return Number.NaN;
  const local = LOCAL_ISO.exec(s);
  if (local) return instantOf(local[1]!, local[2]!, DUE_DEFAULT_ZONE) + Math.floor(Number((local[3] ?? ":00").slice(1)) * 1000);
  return Date.parse(s);
}
