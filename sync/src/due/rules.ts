// Which Due reminders Esme wants right now: one pure function of her open to-dos and habits,
// her settings and the time. The cron (due/cron.ts) diffs this against what Due holds.
//
// Every reminder has a KEY: what it is, for which day (yyyymmdd; her day runs 3am to 3am in
// her time zone). reconcile.ts adds a version (a hash of its title and time) to make the id sent
// to Due, so tomorrow's are new reminders and yesterday's are no longer wanted:
//   esmeworld-<day>-plan          "Plan your day" at her morning time
//   esmeworld-<day>-review        "Review your day" at her evening time
//   esmeworld-<date>-t-<item>     a timed to-do, its lead before; <date> is the meeting's own date,
//                                 so the alert keeps one key across the 3am change
//   esmeworld-<day>-r-<item>      "Remind me" on a to-do or habit (remindAt): at its time, or
//                                 minutes before sunset, on a day it is on Today and not done
//   esmeworld-<day>-count         ONE count of what is left on Today ("N to-dos left today, pick
//                                 one") at her count time (14:00), if anything is left
//   esmeworld-<day>-nudge         the motivation nudge, if nothing was ticked off today
//
// Untimed to-dos and habits get no reminder of their own (Esme, 20 Nov 2026: one reminder per
// item at 11:00 and 17:00 was "too many to dos at once"; the old -d1-/-d2- keys are no longer
// wanted, so reconcile cancels any still in Due on its first run). Every item on Today either
// has its own reminder (a time, or Remind me) or is in the count.
//
// "On Today" (onToday below) follows the app's Today list (hub/src/domain/triage.ts todayParts
// and withTickedOff) as far as the Worker can see it: what always shows (pinned for today, a
// project session planned for today, due today or overdue), the habits planned for today, and
// the day's kept picks from the today-fill row (hub/src/domain/todayFill.ts) still open and on
// for today; never hidden today, never an undated Inbox item, never one ticked off. NOT
// followed: a place on Today that was never filled taking a new pick later (that needs her
// goals' pace), and a device's own copy of the picks once she has used Today there.
//
// Titles are the to-do's or habit's title, the fixed words, or one of her motivation lines:
// never notes, pages or anything from the journal (the Worker can't read the journal).
// WORDING IS PROVISIONAL (hers to change).

import type { DuePrefs } from "./prefs";
import { placeFor, sunsetUtc } from "./sun";
import { addDays, appDay, HHMM, instantOf, settingsInstant, weekdayOf } from "./time";

export const PLAN_TITLE = "Plan your day";
export const REVIEW_TITLE = "Review your day";
/** The nudge when she has written no lines of her own. */
export const GENERIC_LINE = "One small thing is enough to start.";
/** The most timed to-do alerts in a day. */
export const MAX_TIMED = 10;
/** The most Remind me reminders in a day. */
export const MAX_OWN = 10;
/** The longest "Before sunset" (minutes). */
export const MAX_BEFORE_SUNSET = 360;
/**
 * The nudge and the count are only put in Due this long before they go off: they aren't needed
 * sooner, and ticks before then cost no calls to Due.
 */
export const NUDGE_AHEAD_MS = 30 * 60_000;
/**
 * The count is replaced each time it changes before it goes off (a new title is a new
 * version); it may be replaced this many times a day before it is left as it is.
 */
export const COUNT_MAX_CANCELS = 12;

/** The count's words (PROVISIONAL, Esme 20 Nov 2026). */
export const countTitle = (n: number) => (n === 1 ? "1 to-do left today, do it" : `${n} to-dos left today, pick one`);
export const MAX_TITLE = 100;

/** One to-do or habit, as the cron reads it from the items table (only what the rules need). */
export interface DueItem {
  id: string;
  title: string;
  kind: string;
  status: string;
  areaId: string;
  priority: number;
  due?: string;
  pinnedDate?: string;
  hiddenOn?: string;
  completedAt?: string;
  recur?: string[];
  time?: string;
  /** A habit ticked today (today is in its doneDates). */
  doneToday?: boolean;
  /** A project with a session ticked today. */
  sessionDoneToday?: boolean;
  /** A project with a session (not ticked) planned for today. */
  sessionPlannedToday?: boolean;
  /** "Remind me": "HH:MM", or "sunset-N" (N minutes before sunset). */
  remindAt?: string;
}

/** Today's kept picks (the today-fill row, hub/src/domain/todayFill.ts): ids, and their due dates when picked. */
export interface TodayPicks {
  ids: readonly string[];
  dues?: Readonly<Record<string, string>>;
}

export type WantedKind = "plan" | "review" | "timed" | "own" | "count" | "nudge";

export interface Wanted {
  /** What it is and for which day (reconcile.ts adds the version). */
  key: string;
  kind: WantedKind;
  title: string;
  /** When it is meant to go off (epoch ms). Part of its version. */
  at: number;
  /**
   * A timed to-do whose lead has passed but whose meeting hasn't (added late): send it to go off
   * at this moment instead (a minute from now). Not part of its version, so it is sent once.
   */
  sendAt?: number;
  /** How many of our own cancellations a day before it is left as it is (reconcile.ts; default 3). */
  maxCancels?: number;
}

export interface RulesInput {
  items: readonly DueItem[];
  prefs: DuePrefs;
  now: number;
  /** Something was ticked off today (worked out in SQL by the cron); else from `items`. */
  tickedToday?: boolean;
  /** Today's kept picks, when a device has shown Today today. */
  fill?: TodayPicks;
}

const REMIND_AT = /^(?:(([01]\d|2[0-3]):[0-5]\d)|sunset-(\d{1,3}))$/;

/** A remindAt as stored: a time, or minutes before sunset; null when it isn't one. */
export function parseRemindAt(v: unknown): { time: string } | { beforeSunset: number } | null {
  if (typeof v !== "string") return null;
  const m = REMIND_AT.exec(v);
  if (!m) return null;
  if (m[1]) return { time: m[1] };
  const n = Number(m[3]);
  return n <= MAX_BEFORE_SUNSET ? { beforeSunset: n } : null;
}

/** "2026-11-16" -> "20261116". */
export const dayToken = (day: string) => day.replaceAll("-", "");

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** FNV-1a, 32-bit, as 8 hex digits (a stable short stand-in for an odd item id). */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const safeId = (id: string) => (SAFE_ID.test(id) ? id : `h${fnv(id)}`);

function shortTitle(t: string): string {
  const plain = t.replace(/\s+/g, " ").trim();
  return plain.length <= MAX_TITLE ? plain : `${plain.slice(0, MAX_TITLE - 1).trimEnd()}…`;
}

const isHabit = (it: DueItem) => (it.recur?.length ?? 0) > 0;
const isOpenTodo = (it: DueItem) => it.kind === "task" && it.status === "open" && it.title.trim() !== "";
const hasTime = (it: DueItem) => it.time !== undefined && HHMM.test(it.time);

/**
 * The day a timed to-do's time is on: its "Do it on" day, else its due date. A pin before `day`
 * is ignored, as Today ignores it.
 */
const timedDay = (it: DueItem, day: string) =>
  it.pinnedDate !== undefined && (it.pinnedDate >= day || it.due === undefined) ? it.pinnedDate : it.due;

function tickedToday(items: readonly DueItem[], day: string): boolean {
  return items.some(
    (it) => (it.status === "done" && it.completedAt === day) || it.doneToday === true || it.sessionDoneToday === true,
  );
}

export function wantedReminders({ items, prefs, now, tickedToday: ticked, fill }: RulesInput): Wanted[] {
  if (!prefs.on) return [];
  const tz = prefs.timeZone;
  const day = appDay(now, tz);
  const prefix = `esmeworld-${dayToken(day)}`;
  const out: Wanted[] = [
    { key: `${prefix}-plan`, kind: "plan", title: PLAN_TITLE, at: settingsInstant(day, prefs.plan, tz) },
    { key: `${prefix}-review`, kind: "review", title: REVIEW_TITLE, at: settingsInstant(day, prefs.review, tz) },
  ];

  // Timed to-dos whose meeting or alert falls in today (a 1am meeting on tomorrow's date is
  // tonight's; a 03:05 meeting's 02:50 alert is wanted before 3am, under the meeting's date).
  const timed: (Wanted & { id: string })[] = [];
  for (const it of items) {
    const on = timedDay(it, day);
    if (!isOpenTodo(it) || isHabit(it) || !hasTime(it) || !on) continue;
    if (on !== day && on !== addDays(day, 1)) continue;
    const moment = instantOf(on, it.time!, tz);
    const alert = moment - prefs.leadMinutes * 60_000;
    if (appDay(moment, tz) !== day && appDay(alert, tz) !== day) continue;
    const w: Wanted & { id: string } = { id: it.id, key: `esmeworld-${dayToken(on)}-t-${safeId(it.id)}`, kind: "timed", title: shortTitle(it.title), at: alert };
    // Added late (the lead has passed, the meeting hasn't): a minute from now.
    if (alert <= now) {
      if (moment <= now + 60_000) continue;
      w.sendAt = now + 60_000;
    }
    timed.push(w);
  }
  timed.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1));
  // Items with a reminder of their own today: never in the count.
  const own = new Set<string>();
  for (const { id, ...w } of timed.slice(0, MAX_TIMED)) {
    own.add(id);
    out.push(w);
  }

  // What is left on Today (see the top of this file).
  const weekday = weekdayOf(day);
  const kept = new Set(fill?.ids ?? []);
  const onToday = (it: DueItem): boolean => {
    if (!isOpenTodo(it) || it.hiddenOn === day) return false;
    if (isHabit(it)) return it.areaId !== "inbox" && it.recur!.includes(weekday) && it.doneToday !== true;
    // A project whose session for today is ticked is crossed out (unless another is planned).
    if (it.sessionDoneToday === true && it.sessionPlannedToday !== true) return false;
    if (it.pinnedDate === day || it.sessionPlannedToday === true) return true;
    // Moved to a later day on purpose: not today.
    if (it.pinnedDate !== undefined && it.pinnedDate > day) return false;
    if (it.due !== undefined && it.due <= day) return true;
    if (!kept.has(it.id) || (it.areaId === "inbox" && it.pinnedDate === undefined && it.due === undefined)) return false;
    // A kept pick whose deadline was pushed out (or taken off) since it was picked has left Today.
    const was = fill?.dues?.[it.id];
    return was === undefined || (it.due !== undefined && it.due <= was);
  };
  const left = items.filter(onToday);

  // Remind me: at its time, or minutes before sunset; a to-do with a time of its own uses that.
  let place: ReturnType<typeof placeFor> | undefined;
  let sunset: number | null | undefined;
  const sunsetToday = () => {
    if (sunset === undefined) {
      place ??= placeFor(prefs);
      sunset = place ? sunsetUtc(day, place.lat, place.lon) : null;
    }
    return sunset;
  };
  const mine: (Wanted & { id: string })[] = [];
  for (const it of left) {
    if (it.remindAt === undefined || (!isHabit(it) && hasTime(it))) continue;
    const r = parseRemindAt(it.remindAt);
    if (!r) continue;
    let when: number;
    if ("time" in r) when = settingsInstant(day, r.time, tz);
    else {
      const s = sunsetToday();
      if (s === null) continue; // no place known, or no sunset there today: counted instead
      when = s - r.beforeSunset * 60_000;
    }
    mine.push({ id: it.id, key: `${prefix}-r-${safeId(it.id)}`, kind: "own", title: shortTitle(it.title), at: when });
  }
  mine.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1));
  for (const { id, ...w } of mine.slice(0, MAX_OWN)) {
    own.add(id);
    out.push(w);
  }

  // The count: once a day, only near its time, only when something is left.
  const countAt = settingsInstant(day, prefs.countNudge, tz);
  if (now >= countAt - NUDGE_AHEAD_MS) {
    let n = 0;
    for (const it of left) if (!own.has(it.id)) n++;
    if (n > 0) out.push({ key: `${prefix}-count`, kind: "count", title: countTitle(n), at: countAt, maxCancels: COUNT_MAX_CANCELS });
  }

  // The motivation nudge: only near its time, and only if nothing was ticked off today.
  const nudgeAt = settingsInstant(day, prefs.nudge, tz);
  if (now >= nudgeAt - NUDGE_AHEAD_MS && !(ticked ?? tickedToday(items, day))) {
    const lines = prefs.lines;
    const dayIndex = Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
    const title = lines.length ? shortTitle(lines[dayIndex % lines.length]!) : GENERIC_LINE;
    out.push({ key: `${prefix}-nudge`, kind: "nudge", title, at: nudgeAt });
  }
  return out;
}
