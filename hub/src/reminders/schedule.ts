// Reminders (2026-11-04, Esme's pick 4A "a simple list"; mockup reviews-search.html part 4).
//
// The schedule is worked out here, in one pure function, from this device's settings and the
// app's data; whatever shows the notifications (the Mac app now, an iPhone app or a push
// server later) only has to deliver what this returns. Each run covers the next 7 days and is
// recomputed whenever anything changes, so a reminder whose thing is already done that day
// ("skips itself if already done") simply isn't in the next schedule.
//
// A notification may hold titles and counts only: never journal text, notes or page content.
// Wording is the mockup's first draft (hers to change).

import { addDays, mondayOf, weekdayOf } from "../domain/dates";
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

/** One notification to show: `at` is a local wall-clock time, "YYYY-MM-DDTHH:MM". */
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
  /** The local date and "HH:MM" now: anything at or before it is left out. */
  now: { date: ISODate; time: string };
  /** The app's items (any status; filtered here). */
  items: readonly Item[];
  /** Days with morning pages done; null when this device can't tell (journal locked): then it reminds. */
  morningDone: ReadonlySet<ISODate> | null;
  /** Days checked in; null when this device can't tell. */
  checkinDone: ReadonlySet<ISODate> | null;
  /** Reviews already done: weeks by their Monday, months as "YYYY-MM". Not built yet; absent = none. */
  reviewsDone?: { weeks: ReadonlySet<ISODate>; months: ReadonlySet<string> };
  /** How many days ahead, today included (default 7). */
  days?: number;
}

/** Days the schedule covers, today included. */
export const SCHEDULE_DAYS = 7;
/**
 * The most reminders in one schedule. Apple keeps at most 64 pending local notifications per
 * app (the soonest win); this leaves room under that.
 */
export const MAX_SCHEDULED = 60;

/** Where the reviews open. The reviews are being built separately: Home until then. */
export const REVIEW_PATH = "/";

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

/** An open, one-off to-do that isn't off Today for that day. */
function liveTodo(it: Item, day: ISODate): boolean {
  return it.kind === "task" && it.status === "open" && (it.recur?.length ?? 0) === 0 && it.hiddenOn !== day;
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

/** The reminders for the next `days` days, soonest first. Pure. */
export function computeSchedule(input: ScheduleInput): ScheduledReminder[] {
  const { settings: s, now, items } = input;
  const days = input.days ?? SCHEDULE_DAYS;
  const nowAt = `${now.date}T${now.time}`;
  const out: ScheduledReminder[] = [];
  const add = (r: ScheduledReminder) => {
    if (r.at > nowAt) out.push(r);
  };

  for (let i = 0; i < days; i++) {
    const day = addDays(now.date, i);
    const at = (time: string) => `${day}T${time}`;

    if (s.morning.on && !input.morningDone?.has(day)) {
      add({ id: `morning:${day}`, at: at(s.morning.time), title: "Morning pages", body: "Three pages, before anything else.", path: "/journal/morning" });
    }
    if (s.checkin.on && !input.checkinDone?.has(day)) {
      add({ id: `checkin:${day}`, at: at(s.checkin.time), title: "Daily check-in", body: "A few questions to close the day.", path: "/journal/check-in" });
    }

    if (s.todos.on) {
      const tomorrow = addDays(day, 1);
      const today = items.filter((it) => liveTodo(it, day) && (it.pinnedDate === day || it.due === day));
      const todayIds = new Set(today.map((it) => it.id));
      const dueTomorrow = s.todos.dayBefore
        ? items.filter((it) => liveTodo(it, day) && it.due === tomorrow && !todayIds.has(it.id))
        : [];
      if (today.length > 0 || dueTomorrow.length > 0) {
        const title = today.length > 0 ? `${plural(today.length, "to-do")} today` : `${plural(dueTomorrow.length, "deadline")} tomorrow`;
        const parts: string[] = [];
        if (today.length > 0) parts.push(names(today.map((it) => it.title)));
        if (dueTomorrow.length > 0) {
          const list = names(dueTomorrow.map((it) => it.title));
          parts.push(today.length > 0 ? `Due tomorrow: ${list}` : list);
        }
        add({ id: `todos:${day}`, at: at(s.todos.time), title, body: parts.join(" · "), path: "/today" });
      }
    }

    if (s.session.on) {
      for (const it of items) {
        if (!isProject(it) || it.status !== "open" || it.hiddenOn === day) continue;
        const list = it.sessions ?? [];
        const idx = list.findIndex((x) => x.doneOn === undefined && x.plannedFor === day);
        if (idx < 0) continue;
        add({
          id: `session:${day}:${it.id}`,
          at: at(s.session.time),
          title: it.title,
          body: `Session ${idx + 1} of ${list.length} is planned for today.`,
          path: "/today",
        });
      }
    }

    if (s.weekly.on && weekdayOf(day) === s.weekly.day) {
      // The week looked back on: on a Monday, the week that just ended.
      const week = mondayOf(s.weekly.day === "mon" ? addDays(day, -1) : day);
      if (!input.reviewsDone?.weeks.has(week)) {
        add({ id: `weekly:${day}`, at: at(s.weekly.time), title: "Weekly review", body: "Your week is ready to look back on.", path: REVIEW_PATH });
      }
    }

    if (s.monthly.on) {
      const isDay = s.monthly.when === "first" ? day.endsWith("-01") : day === lastSundayOf(day);
      const month = s.monthly.when === "first" ? previousMonth(day) : day.slice(0, 7);
      if (isDay && !input.reviewsDone?.months.has(month)) {
        add({
          id: `monthly:${day}`,
          at: at(s.monthly.time),
          title: `${MONTHS[Number(month.slice(5, 7)) - 1]} review`,
          body: "Your month is ready to look back on.",
          path: REVIEW_PATH,
        });
      }
    }
  }

  return out
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MAX_SCHEDULED);
}

/** The local date and "HH:MM" of a clock reading. */
export function localNow(d: Date): { date: ISODate; time: string } {
  const p = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
}

/** Milliseconds from `d` to the next local midnight (at least 1 s). */
export function msToMidnight(d: Date): number {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 1);
  return Math.max(1000, next.getTime() - d.getTime());
}
