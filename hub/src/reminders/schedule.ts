// Reminders (2026-11-04, Esme's pick 4A "a simple list"; mockup reviews-search.html part 4).
//
// The schedule is worked out here, in one pure function, from this device's settings and the
// app's data; whatever shows the notifications (the Mac app now, an iPhone app or a push
// server later) only has to deliver what this returns. It is recomputed whenever anything
// changes, so a reminder whose thing is already done that day ("skips itself if already done")
// simply isn't in the next schedule.
//
// Days are Esme's app-days (domain/dates.ts DAY_ENDS_AT_HOUR: a day runs 3am to 3am). A
// reminder belongs to an app-day: its id, its "already done?" check and its to-dos are that
// day's. A time before 3am fires after midnight, at the end of its app-day (a 01:00 check-in on
// Wednesday pops up at 01:00 on Thursday's calendar date, and a check-in done at 00:40 that
// night counts for Wednesday).
//
// The list is filled soonest first up to MAX_SCHEDULED (Apple keeps at most 64 pending per
// app), so reminders keep going for as long as possible after the app was last opened.
//
// A notification may hold titles and counts only: never journal text, notes or page content.
// Wording is the mockup's first draft (hers to change).

import { addDays, DAY_ENDS_AT_HOUR, mondayOf, weekdayOf } from "../domain/dates";
import { isProject } from "../domain/projects";
import type { ISODate, Item } from "../domain/types";

export type ReviewWeekday = "sun" | "sat" | "mon";
export const REVIEW_WEEKDAYS: readonly ReviewWeekday[] = ["sun", "sat", "mon"];
export type MonthlyWhen = "first" | "last-sunday";
export const MONTHLY_WHENS: readonly MonthlyWhen[] = ["first", "last-sunday"];

/** Per device (each device notifies by itself), never synced. Times are local "HH:MM". */
export interface ReminderSettings {
  morning: { on: boolean; time: string };
  checkin: { on: boolean; time: string };
  /** To-dos on their "Do it on" day and deadlines; `dayBefore`: deadlines also the day before. */
  todos: { on: boolean; time: string; dayBefore: boolean };
  /** A project session planned for that day. */
  session: { on: boolean; time: string };
  weekly: { on: boolean; day: ReviewWeekday; time: string };
  monthly: { on: boolean; when: MonthlyWhen; time: string };
}

export type ReminderKind = keyof ReminderSettings;

/** The mockup's (4A) times and On / Off. */
export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  morning: { on: true, time: "08:30" },
  checkin: { on: true, time: "20:00" },
  todos: { on: true, time: "09:00", dayBefore: true },
  session: { on: true, time: "10:00" },
  weekly: { on: true, day: "sun", time: "16:00" },
  monthly: { on: false, when: "first", time: "10:00" },
};

/**
 * One notification to show: `at` is a local wall-clock time, "YYYY-MM-DDTHH:MM". `id` is
 * "<kind>:<app-day>" (sessions: "session:<app-day>:<item id>").
 */
export interface ScheduledReminder {
  id: string;
  at: string;
  title: string;
  body: string;
  /** Where tapping it opens the app (an app route). */
  path: string;
}

export interface ScheduleInput {
  settings: ReminderSettings;
  /** The local calendar date and "HH:MM" now (wall clock): anything at or before it is left out. */
  now: { date: ISODate; time: string };
  /** The app's items (any status; filtered here). */
  items: readonly Item[];
  /** App-days with morning pages done; null when this device can't tell: then it reminds. */
  morningDone: ReadonlySet<ISODate> | null;
  /** App-days checked in; null when this device can't tell (journal locked). */
  checkinDone: ReadonlySet<ISODate> | null;
  /** Reviews already done: weeks by their Monday, months as "YYYY-MM". Not built yet; absent = none. */
  reviewsDone?: { weeks: ReadonlySet<ISODate>; months: ReadonlySet<string> };
  /** The furthest it looks, in app-days, today included (default MAX_DAYS). */
  days?: number;
}

/**
 * The most reminders in one schedule. Apple keeps at most 64 pending local notifications per
 * app (the soonest win); this leaves room under that (the Mac self-test's 2 probe reminders
 * included).
 */
export const MAX_SCHEDULED = 60;
/** How far ahead it looks at most (app-days), however few reminders are on. */
export const MAX_DAYS = 92;

/** Where the reviews open. The reviews are being built separately: Home until then. */
export const REVIEW_PATH = "/";

/** "03:00": a reminder time before it belongs to the end of its app-day (after midnight). */
export const DAY_CHANGE_TIME = `${String(DAY_ENDS_AT_HOUR).padStart(2, "0")}:00`;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Settings as stored (anything, from any version), made whole: whatever is missing or broken is the default. */
export function normalizeReminderSettings(raw: unknown): ReminderSettings {
  const d = DEFAULT_REMINDER_SETTINGS;
  const src = isObj(raw) ? raw : {};
  const part = (k: ReminderKind) => (isObj(src[k]) ? (src[k] as Record<string, unknown>) : {});
  const on = (k: ReminderKind) => (typeof part(k).on === "boolean" ? (part(k).on as boolean) : d[k].on);
  const time = (k: ReminderKind) => {
    const t = part(k).time;
    return typeof t === "string" && TIME.test(t) ? t : d[k].time;
  };
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;
  return {
    morning: { on: on("morning"), time: time("morning") },
    checkin: { on: on("checkin"), time: time("checkin") },
    todos: {
      on: on("todos"),
      time: time("todos"),
      dayBefore: typeof part("todos").dayBefore === "boolean" ? (part("todos").dayBefore as boolean) : d.todos.dayBefore,
    },
    session: { on: on("session"), time: time("session") },
    weekly: { on: on("weekly"), day: pick(part("weekly").day, REVIEW_WEEKDAYS, d.weekly.day), time: time("weekly") },
    monthly: { on: on("monthly"), when: pick(part("monthly").when, MONTHLY_WHENS, d.monthly.when), time: time("monthly") },
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "A", "A and B", "A, B and 3 more". */
function names(titles: string[]): string {
  if (titles.length <= 2) return titles.join(" and ");
  return `${titles.slice(0, 2).join(", ")} and ${titles.length - 2} more`;
}

/** The app-day a wall-clock moment belongs to (before 3am: the day before). */
export function appDayOf(date: ISODate, time: string): ISODate {
  return time < DAY_CHANGE_TIME ? addDays(date, -1) : date;
}

/** When a reminder at `time` on app-day `day` goes off (wall clock). */
export function wallTime(day: ISODate, time: string): string {
  return `${time < DAY_CHANGE_TIME ? addDays(day, 1) : day}T${time}`;
}

/** A project with a not-done session planned for `day`: its index, else -1. */
function plannedIndex(it: Item, day: ISODate): number {
  if (!isProject(it) || it.status !== "open" || it.hiddenOn === day) return -1;
  return (it.sessions ?? []).findIndex((x) => x.doneOn === undefined && x.plannedFor === day);
}

/**
 * A to-do the to-dos line counts on `day`, as Today does (domain/triage.ts): an open, one-off
 * to-do outside the Inbox that isn't off Today that day, isn't moved to a later day, and isn't a
 * project with a session that day (that one has its own reminder).
 */
function countedTodo(it: Item, day: ISODate): boolean {
  return (
    it.kind === "task" && it.status === "open" && (it.recur?.length ?? 0) === 0 && it.areaId !== "inbox" &&
    it.hiddenOn !== day && !(it.pinnedDate !== undefined && it.pinnedDate > day) && plannedIndex(it, day) < 0
  );
}

function lastSundayOf(day: ISODate): ISODate {
  const nextMonth = addDays(`${day.slice(0, 7)}-01`, 31).slice(0, 7);
  let d = addDays(`${nextMonth}-01`, -1); // the last day of `day`'s month
  while (weekdayOf(d) !== "sun") d = addDays(d, -1);
  return d;
}

function previousMonth(day: ISODate): string {
  return addDays(`${day.slice(0, 7)}-01`, -1).slice(0, 7);
}

/** Every reminder that belongs to app-day `day` (whatever the time now), soonest first. Pure. */
export function remindersOn(input: Omit<ScheduleInput, "now" | "days">, day: ISODate): ScheduledReminder[] {
  const { settings: s, items } = input;
  const out: ScheduledReminder[] = [];
  const at = (time: string) => wallTime(day, time);

  if (s.morning.on && !input.morningDone?.has(day)) {
    out.push({ id: `morning:${day}`, at: at(s.morning.time), title: "Morning pages", body: "Three pages, before anything else.", path: "/journal/morning" });
  }
  if (s.checkin.on && !input.checkinDone?.has(day)) {
    out.push({ id: `checkin:${day}`, at: at(s.checkin.time), title: "Daily check-in", body: "A few questions to close the day.", path: "/journal/check-in" });
  }

  if (s.todos.on) {
    const tomorrow = addDays(day, 1);
    const today = items.filter((it) => countedTodo(it, day) && (it.pinnedDate === day || it.due === day));
    const todayIds = new Set(today.map((it) => it.id));
    const dueTomorrow = s.todos.dayBefore
      ? items.filter((it) => countedTodo(it, day) && it.due === tomorrow && !todayIds.has(it.id))
      : [];
    if (today.length > 0 || dueTomorrow.length > 0) {
      const title = today.length > 0 ? `${plural(today.length, "to-do")} today` : `${plural(dueTomorrow.length, "deadline")} tomorrow`;
      const parts: string[] = [];
      if (today.length > 0) parts.push(names(today.map((it) => it.title)));
      if (dueTomorrow.length > 0) {
        const list = names(dueTomorrow.map((it) => it.title));
        parts.push(today.length > 0 ? `Due tomorrow: ${list}` : list);
      }
      out.push({ id: `todos:${day}`, at: at(s.todos.time), title, body: parts.join(" · "), path: "/" });
    }
  }

  if (s.session.on) {
    for (const it of items) {
      const idx = plannedIndex(it, day);
      if (idx < 0) continue;
      out.push({
        id: `session:${day}:${it.id}`,
        at: at(s.session.time),
        title: it.title,
        body: `Session ${idx + 1} of ${it.sessions!.length} is planned for today.`,
        path: "/",
      });
    }
  }

  if (s.weekly.on && weekdayOf(day) === s.weekly.day) {
    // The week looked back on: on a Monday, the week that just ended.
    const week = mondayOf(s.weekly.day === "mon" ? addDays(day, -1) : day);
    if (!input.reviewsDone?.weeks.has(week)) {
      out.push({ id: `weekly:${day}`, at: at(s.weekly.time), title: "Weekly review", body: "Your week is ready to look back on.", path: REVIEW_PATH });
    }
  }

  if (s.monthly.on) {
    const isDay = s.monthly.when === "first" ? day.endsWith("-01") : day === lastSundayOf(day);
    const month = s.monthly.when === "first" ? previousMonth(day) : day.slice(0, 7);
    if (isDay && !input.reviewsDone?.months.has(month)) {
      out.push({
        id: `monthly:${day}`,
        at: at(s.monthly.time),
        title: `${MONTHS[Number(month.slice(5, 7)) - 1]} review`,
        body: "Your month is ready to look back on.",
        path: REVIEW_PATH,
      });
    }
  }
  return out.sort(byTime);
}

function byTime(a: ScheduledReminder, b: ScheduledReminder): number {
  return a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The reminders from now on, soonest first: app-day by app-day from today's, until
 * MAX_SCHEDULED or `days` app-days. Pure.
 */
export function computeSchedule(input: ScheduleInput): ScheduledReminder[] {
  const { now } = input;
  const days = input.days ?? MAX_DAYS;
  const nowAt = `${now.date}T${now.time}`;
  const first = appDayOf(now.date, now.time);
  const out: ScheduledReminder[] = [];
  // Every reminder of an app-day goes off within it (3am to 3am), so app-days come in time order.
  for (let i = 0; i < days && out.length < MAX_SCHEDULED; i++) {
    for (const r of remindersOn(input, addDays(first, i))) if (r.at > nowAt) out.push(r);
  }
  return out.slice(0, MAX_SCHEDULED);
}

/** The calendar date of the last reminder (how far ahead it is planned), or null for none. */
export function plannedUntil(list: readonly ScheduledReminder[]): ISODate | null {
  return list.length ? list[list.length - 1].at.slice(0, 10) : null;
}

/** The local calendar date and "HH:MM" of a clock reading. */
export function localNow(d: Date): { date: ISODate; time: string } {
  const p = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
}

/** Milliseconds from `d` to just after the next app-day change (3am local; at least 1 s). */
export function msToDayChange(d: Date): number {
  let next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), DAY_ENDS_AT_HOUR, 0, 1);
  if (next.getTime() <= d.getTime()) next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, DAY_ENDS_AT_HOUR, 0, 1);
  return Math.max(1000, next.getTime() - d.getTime());
}
