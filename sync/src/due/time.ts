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

// CPU (re-review R-I1): the first Intl.DateTimeFormat with a time zone costs about 15 ms in a
// fresh isolate (ICU's zone data), more than a whole run may use. So:
// - the zones the app offers (hub DueSection ZONES) are worked out by arithmetic from their
//   rules, with no Intl at all (checked against Intl in time.test.ts, 2026-2031);
// - any other zone uses one cached Intl formatter per zone, and Intl is warmed up once at
//   module scope (isolate start-up, not a run's own time).
// If a country changes its clock rules, ZONE_RULES needs updating; the test against Intl then
// fails on a runtime with the new data.

type DstRule = "us" | "eu" | "au";
/** Standard offset (minutes east of UTC) and daylight-saving rule (+60 minutes while on). */
const ZONE_RULES: Record<string, { std: number; dst?: DstRule }> = {
  "America/New_York": { std: -300, dst: "us" },
  "America/Chicago": { std: -360, dst: "us" },
  "America/Denver": { std: -420, dst: "us" },
  "America/Los_Angeles": { std: -480, dst: "us" },
  "America/Sao_Paulo": { std: -180 },
  "Europe/London": { std: 0, dst: "eu" },
  "Europe/Lisbon": { std: 0, dst: "eu" },
  "Europe/Paris": { std: 60, dst: "eu" },
  "Europe/Berlin": { std: 60, dst: "eu" },
  "Asia/Tokyo": { std: 540 },
  "Australia/Sydney": { std: 600, dst: "au" },
  UTC: { std: 0 },
};

/** The UTC day (ms) of the n-th (1-based; -1 = last) Sunday of a month (0-based). */
function sunday(year: number, month: number, n: number): number {
  if (n > 0) {
    const first = Date.UTC(year, month, 1);
    const dow = new Date(first).getUTCDay();
    return first + (((7 - dow) % 7) + (n - 1) * 7) * DAY_MS;
  }
  const last = Date.UTC(year, month + 1, 0);
  return last - new Date(last).getUTCDay() * DAY_MS;
}

const HOUR_MS = 3_600_000;

/** Daylight saving is on at this instant, by the zone's rule. */
function dstOn(rule: DstRule, std: number, ms: number): boolean {
  const year = new Date(ms + std * MINUTE_MS).getUTCFullYear();
  if (rule === "us") {
    // 2nd Sunday of March, 02:00 standard time, to 1st Sunday of November, 02:00 daylight time.
    const start = sunday(year, 2, 2) + 2 * HOUR_MS - std * MINUTE_MS;
    const end = sunday(year, 10, 1) + 2 * HOUR_MS - (std + 60) * MINUTE_MS;
    return ms >= start && ms < end;
  }
  if (rule === "eu") {
    // Last Sunday of March to last Sunday of October, 01:00 UTC.
    return ms >= sunday(year, 2, -1) + HOUR_MS && ms < sunday(year, 9, -1) + HOUR_MS;
  }
  // Sydney: off from the 1st Sunday of April, 03:00 daylight time, until the 1st Sunday of
  // October, 02:00 standard time.
  const end = sunday(year, 3, 1) + 3 * HOUR_MS - (std + 60) * MINUTE_MS;
  const start = sunday(year, 9, 1) + 2 * HOUR_MS - std * MINUTE_MS;
  return ms < end || ms >= start;
}

/** Minutes east of UTC by the zone's rule, or null for a zone without one here. */
function ruleOffset(ms: number, tz: string): number | null {
  const z = ZONE_RULES[tz];
  if (!z) return null;
  return z.std + (z.dst && dstOn(z.dst, z.std, ms) ? 60 : 0);
}

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

// Warm Intl up at module scope (isolate start-up), for zones without a rule here.
try {
  formatter(DEFAULT_TIME_ZONE).formatToParts(new Date(0));
} catch {
  // never fatal
}

/** True when the runtime knows this IANA time zone. */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  if (tz in ZONE_RULES) return true;
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
  const off = ruleOffset(ms, tz);
  if (off !== null) {
    const iso = new Date(Math.floor(ms / MINUTE_MS) * MINUTE_MS + off * MINUTE_MS).toISOString();
    return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
  }
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) parts[p.type] = p.value;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const utcOf = (date: string, time: string) =>
  Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), Number(time.slice(0, 2)), Number(time.slice(3, 5)));

/** Minutes `tz` is ahead of UTC at an instant (New York in winter: -300). */
export function offsetMinutes(ms: number, tz: string): number {
  const off = ruleOffset(ms, tz);
  if (off !== null) return off;
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
