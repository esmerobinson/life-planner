// The daily log and the weekly review (Esme's routine plan, 16 Nov 2026): what is inside their
// sealed journal rows once opened (only ever in memory), and how a day's (or week's) versions are
// merged. Pure: the reads and writes are data/routineRepo.ts.
//
// - Daily log ("day-log"): "Stuck to my daily schedule?" and "Finished today's to-dos?", each
//   Yes / Partly / No with an optional short note.
// - Weekly review ("week-review"): what went well, what got in the way, living my values (1-10),
//   one if-then plan for next week, and which minimum days she expects next week. Offered on
//   Sundays, open any day of that week (Monday to Sunday). Counts as Mental health work.
//
// Both keep the learned-words pattern (journalRepo "learned"): one row per VERSION
// (`<kind>:<date>:<deviceId>_<vid>`), each naming the versions she had in front of her when she
// wrote it (`seen`: `<row id>@<at>`), so no device ever writes over another's row and nothing is
// ever cleared silently. A box session rewrites only its own row while she types.

import { isObj, isStr } from "../data/validate";
import { isValidISODate, todayISO } from "../domain/dates";
import { WEEKDAYS, type ISODate, type Weekday } from "../domain/types";

export type Choice = "yes" | "partly" | "no";
export const CHOICES: readonly Choice[] = ["yes", "partly", "no"];

/** The most a daily log note holds (characters). */
export const MAX_LOG_NOTE = 1000;
/** The most a weekly review box holds (characters). */
export const MAX_REVIEW_TEXT = 4000;

export interface DayLogFields {
  schedule: Choice | null;
  scheduleNote: string;
  todos: Choice | null;
  todosNote: string;
}

export interface WeekReviewFields {
  well: string;
  inWay: string;
  /** "Am I living my values?" 1 to 10, or not answered. */
  values: number | null;
  ifThen: string;
  /** The days of next week she expects to be minimum days (Monday first). */
  minDays: Weekday[];
}

/** What every version row of either kind also holds. */
interface VersionStamp {
  v: 1;
  /** When she pressed Done (null: not yet). An edit after Done keeps it. */
  submittedAt: number | null;
  /**
   * The app day (3am rule) she pressed Done: the day it belongs to (review C1: never the day it
   * was first touched). Kept by every later edit. Earlier rows: the app day of `submittedAt`.
   */
  doneOn?: ISODate;
  /** This write (strictly newer than the row's previous write). */
  at: number;
  /** The versions this one replaces (`<row id>@<at>`). */
  seen?: string[];
}

export type DayLogEntry = VersionStamp & DayLogFields;
export type WeekReviewEntry = VersionStamp & WeekReviewFields;

export const EMPTY_DAY_LOG: DayLogFields = { schedule: null, scheduleNote: "", todos: null, todosNote: "" };
export const EMPTY_WEEK_REVIEW: WeekReviewFields = { well: "", inWay: "", values: null, ifThen: "", minDays: [] };

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const choice = (v: unknown) => v === null || CHOICES.includes(v as Choice);
const text = (max: number) => (v: unknown) => isStr(v) && v.length <= max;
const seenOk = (v: unknown) =>
  v === undefined || (Array.isArray(v) && v.length <= 64 && v.every((x) => isStr(x) && x.length <= 256));
const stampOk = (v: Record<string, unknown>) =>
  v.v === 1 && (v.submittedAt === null || num(v.submittedAt)) && num(v.at) && seenOk(v.seen) &&
  (v.doneOn === undefined || (isStr(v.doneOn) && isValidISODate(v.doneOn)));

export function isDayLogEntry(v: unknown): v is DayLogEntry {
  return (
    isObj(v) && stampOk(v) && choice(v.schedule) && choice(v.todos) &&
    text(MAX_LOG_NOTE)(v.scheduleNote) && text(MAX_LOG_NOTE)(v.todosNote)
  );
}

export function isWeekReviewEntry(v: unknown): v is WeekReviewEntry {
  return (
    isObj(v) && stampOk(v) &&
    [v.well, v.inWay, v.ifThen].every(text(MAX_REVIEW_TEXT)) &&
    (v.values === null || (Number.isInteger(v.values) && (v.values as number) >= 1 && (v.values as number) <= 10)) &&
    Array.isArray(v.minDays) && v.minDays.length <= 7 && new Set(v.minDays).size === v.minDays.length &&
    v.minDays.every((d) => WEEKDAYS.includes(d as Weekday))
  );
}

export const dayLogFields = (e: DayLogFields): DayLogFields => ({
  schedule: e.schedule, scheduleNote: e.scheduleNote, todos: e.todos, todosNote: e.todosNote,
});
export const weekReviewFields = (e: WeekReviewFields): WeekReviewFields => ({
  well: e.well, inWay: e.inWay, values: e.values, ifThen: e.ifThen,
  minDays: WEEKDAYS.filter((d) => e.minDays.includes(d)),
});

/** Anything answered or written. */
export const dayLogFilled = (f: DayLogFields): boolean =>
  f.schedule !== null || f.todos !== null || f.scheduleNote.trim() !== "" || f.todosNote.trim() !== "";
export const weekReviewFilled = (f: WeekReviewFields): boolean =>
  [f.well, f.inWay, f.ifThen].some((t) => t.trim() !== "") || f.values !== null || f.minDays.length > 0;

/** The same answers (two versions with these are one, as she sees it). */
export const dayLogKey = (f: DayLogFields): string =>
  JSON.stringify([f.schedule, f.scheduleNote.trim(), f.todos, f.todosNote.trim()]);
export const weekReviewKey = (f: WeekReviewFields): string =>
  JSON.stringify([f.well.trim(), f.inWay.trim(), f.values, f.ifThen.trim(), weekReviewFields(f).minDays]);

// ---- merging a day's (or week's) versions -------------------------------------------------------

/** One version as opened. */
export interface FormVersion<F> {
  /** Its row id. */
  id: string;
  /** The day its row is filed under. */
  date: ISODate;
  /** The device that wrote it. */
  device: string;
  fields: F;
  submittedAt: number | null;
  /** The app day she pressed Done (null: not done). */
  doneOn: ISODate | null;
  at: number;
  /**
   * What to put in `seen` to replace this version as she sees it: `<id>@<at>` for it and every
   * other live version with the same answers (shown once, so replaced together).
   */
  seen: string[];
}

export interface FormDay<F> extends FormVersion<F> {
  /** Done (she pressed Done on it, or on a version with the same answers) and something answered. */
  done: boolean;
  /**
   * The day it belongs to (Together's note and private tick, the green row, the farm): the day she
   * pressed Done; while not done, the day of its newest version (the day she last edited it).
   */
  day: ISODate;
  /** Every other version not replaced, with something in it, newest first. */
  others: FormVersion<F>[];
  /** Rows this device can't open. */
  unreadable: number;
}

/** A version as stored, before merging. */
export interface RawVersion<F> {
  id: string;
  date: ISODate;
  device: string;
  fields: F;
  submittedAt: number | null;
  /** As stored (absent on earlier rows). */
  doneOn?: ISODate;
  at: number;
  seen: string[];
}

export interface FormRules<F> {
  key: (f: F) => string;
  filled: (f: F) => boolean;
  empty: F;
}

export const DAY_LOG_RULES: FormRules<DayLogFields> = { key: dayLogKey, filled: dayLogFilled, empty: EMPTY_DAY_LOG };
export const WEEK_REVIEW_RULES: FormRules<WeekReviewFields> = { key: weekReviewKey, filled: weekReviewFilled, empty: EMPTY_WEEK_REVIEW };

/** The app day a version was done: as stored, else the app day (3am rule) of its Done. */
const doneDay = (v: { submittedAt: number | null; doneOn?: ISODate }): ISODate | null =>
  v.doneOn ?? (v.submittedAt === null ? null : todayISO(new Date(v.submittedAt)));

/** A `seen` entry: the row id and the stamp she saw. */
export const seenToken = (v: { id: string; at: number }): string => `${v.id}@${v.at}`;

/**
 * The versions shown: the newest not replaced by any version's `seen` (only as written when she
 * saw it: a later write to that row shows again), and every other live one with different
 * answers. Nothing is ever dropped here: a version is gone only when one she wrote names it.
 */
export function mergeVersions<F>(versions: RawVersion<F>[], unreadable: number, rules: FormRules<F>): FormDay<F> {
  const bare = new Set<string>();
  const sawAt = new Map<string, number>();
  for (const t of versions.flatMap((v) => v.seen)) {
    const cut = t.lastIndexOf("@");
    const at = cut > 0 ? Number(t.slice(cut + 1)) : NaN;
    if (cut > 0 && Number.isFinite(at)) sawAt.set(t.slice(0, cut), Math.max(at, sawAt.get(t.slice(0, cut)) ?? -Infinity));
    else bare.add(t);
  }
  const replaced = (v: RawVersion<F>) => bare.has(v.id) || (sawAt.get(v.id) ?? -Infinity) >= v.at;
  const live = versions.filter((v) => !replaced(v)).sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
  const same = (f: F) => live.filter((v) => rules.key(v.fields) === rules.key(f));
  const view = (v: RawVersion<F>, done: RawVersion<F> | undefined): FormVersion<F> => ({
    id: v.id, date: v.date, device: v.device, fields: v.fields, at: v.at, seen: same(v.fields).map(seenToken),
    submittedAt: done?.submittedAt ?? null, doneOn: done ? doneDay(done) : null,
  });
  // Done on any version with the same answers counts (two devices, the same answers).
  const doneOf = (v: RawVersion<F>) => same(v.fields).find((x) => x.submittedAt !== null);
  const top = live[0];
  const shown: FormVersion<F> = top
    ? view(top, doneOf(top))
    : { id: "", date: "", device: "", fields: rules.empty, submittedAt: null, doneOn: null, at: 0, seen: [] };
  const keys = new Set([rules.key(shown.fields)]);
  const others: FormVersion<F>[] = [];
  for (const v of live.slice(1)) {
    const k = rules.key(v.fields);
    if (!rules.filled(v.fields) || keys.has(k)) continue;
    keys.add(k);
    others.push(view(v, v.submittedAt !== null ? v : undefined));
  }
  const done = shown.submittedAt !== null && rules.filled(shown.fields);
  return { ...shown, done, day: done && shown.doneOn ? shown.doneOn : shown.date, others, unreadable };
}

// ---- the week ------------------------------------------------------------------------------------

/** The weekly review is offered on Sundays (and open any day Monday to Sunday of that week). */
export const isReviewDay = (date: ISODate): boolean => new Date(`${date}T12:00:00`).getDay() === 0;
