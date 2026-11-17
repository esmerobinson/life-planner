// Which Due reminders Esme wants right now: one pure function of her open to-dos and habits,
// her settings and the time. The cron (due/cron.ts) diffs this against what Due holds.
//
// Every reminder has a KEY: what it is, for which day (yyyymmdd; her day runs 3am to 3am in
// her time zone). reconcile.ts adds a version (a hash of its title and time) to make the id sent
// to Due, so tomorrow's are new reminders and yesterday's are no longer wanted:
//   esmeworld-<day>-plan          "Plan your day" at her morning time
//   esmeworld-<day>-review        "Review your day" at her evening time
//   esmeworld-<day>-d1-<item>     due today / overdue / pinned today / a habit planned today,
//   esmeworld-<day>-d2-<item>     at the first and the second pass (at most MAX_DUE_TODAY each)
//   esmeworld-<date>-t-<item>     a timed to-do, its lead before; <date> is the meeting's own date,
//                                 so the alert keeps one key across the 3am change
//   esmeworld-<day>-nudge         the motivation nudge, if nothing was ticked off today
//
// Titles are the to-do's or habit's title, the two fixed words, or one of her motivation
// lines: never notes, pages or anything from the journal (the Worker can't read the journal).
// WORDING IS PROVISIONAL (hers to change).

import type { DuePrefs } from "./prefs";
import { addDays, appDay, HHMM, instantOf, settingsInstant, weekdayOf } from "./time";

export const PLAN_TITLE = "Plan your day";
export const REVIEW_TITLE = "Review your day";
/** The nudge when she has written no lines of her own. */
export const GENERIC_LINE = "One small thing is enough to start.";
/** The most due-today reminders at each pass. */
export const MAX_DUE_TODAY = 8;
/** The most timed to-do alerts in a day. */
export const MAX_TIMED = 10;
/** The nudge is only put in Due this long before it goes off (it isn't needed sooner). */
export const NUDGE_AHEAD_MS = 30 * 60_000;
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
}

export type WantedKind = "plan" | "review" | "due1" | "due2" | "timed" | "nudge";

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
}

export interface RulesInput {
  items: readonly DueItem[];
  prefs: DuePrefs;
  now: number;
  /** Something was ticked off today (worked out in SQL by the cron); else from `items`. */
  tickedToday?: boolean;
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

export function wantedReminders({ items, prefs, now, tickedToday: ticked }: RulesInput): Wanted[] {
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
  const timed: Wanted[] = [];
  const timedIds = new Set<string>();
  for (const it of items) {
    const on = timedDay(it, day);
    if (!isOpenTodo(it) || isHabit(it) || !it.time || !HHMM.test(it.time) || !on) continue;
    if (on !== day && on !== addDays(day, 1)) continue;
    const moment = instantOf(on, it.time, tz);
    const alert = moment - prefs.leadMinutes * 60_000;
    if (appDay(moment, tz) !== day && appDay(alert, tz) !== day) continue;
    timedIds.add(it.id);
    const w: Wanted = { key: `esmeworld-${dayToken(on)}-t-${safeId(it.id)}`, kind: "timed", title: shortTitle(it.title), at: alert };
    // Added late (the lead has passed, the meeting hasn't): a minute from now.
    if (alert <= now) {
      if (moment <= now + 60_000) continue;
      w.sendAt = now + 60_000;
    }
    timed.push(w);
  }
  timed.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1));
  out.push(...timed.slice(0, MAX_TIMED));

  // Due today and not done: priority 1 and habits first.
  const weekday = weekdayOf(day);
  const dueToday = items.filter((it) => {
    if (!isOpenTodo(it) || it.hiddenOn === day || timedIds.has(it.id)) return false;
    if (isHabit(it)) return it.areaId !== "inbox" && it.recur!.includes(weekday) && it.doneToday !== true;
    if (it.pinnedDate === day) return true;
    return it.due !== undefined && it.due <= day && !(it.pinnedDate !== undefined && it.pinnedDate > day);
  });
  const first = (it: DueItem) => (it.priority === 1 || isHabit(it) ? 0 : 1);
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const order = (a: DueItem, b: DueItem) =>
    first(a) - first(b) || a.priority - b.priority || cmp(a.due ?? "~", b.due ?? "~") || cmp(a.title, b.title) || cmp(a.id, b.id);
  // Only the first MAX_DUE_TODAY are needed: kept in order as the list goes by (no full sort).
  const top: DueItem[] = [];
  for (const it of dueToday) {
    if (top.length === MAX_DUE_TODAY && order(it, top[MAX_DUE_TODAY - 1]!) >= 0) continue;
    let i = top.length;
    while (i > 0 && order(it, top[i - 1]!) < 0) i--;
    top.splice(i, 0, it);
    if (top.length > MAX_DUE_TODAY) top.pop();
  }
  for (const [kind, slot, time] of [["due1", "d1", prefs.dueFirst], ["due2", "d2", prefs.dueSecond]] as const) {
    const when = settingsInstant(day, time, tz);
    for (const it of top) {
      out.push({ key: `${prefix}-${slot}-${safeId(it.id)}`, kind, title: shortTitle(it.title), at: when });
    }
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
