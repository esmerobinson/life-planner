// Weekly review v2 (Esme, 17 and 23 Nov 2026): its own Journal tab, submitted as a Mental health
// exercise. What is inside its sealed journal rows ("weekly-review") once opened (only ever in
// memory), its title and which week opens. Pure: the reads and writes are data/routineRepo.ts.
//
// A NEW kind, not more fields on "week-review": an app version from before it never sees these
// rows (sync holds them in quarantine), so it can never show them half, write over them with
// fewer answers, or put any of them in a Together note. The earlier "week-review" rows stay as
// they are, readable in Read back and in the tab's past reviews.
//
// Versions work exactly like the daily log's and the first review's (journal/routine.ts): one row
// per version, `weekly-review:<monday>:<deviceId>_<vid>`, filed under the week's MONDAY (the week
// is chosen, so the day it is written on can't say which week it is). The day it belongs to is
// `doneOn`, the app day (3am rule) she pressed Done.

import { isObj, isStr } from "../data/validate";
import { addDays, mondayOf } from "../domain/dates";
import { WEEKDAYS, type ISODate, type Weekday } from "../domain/types";
import { CHOICES, MAX_REVIEW_TEXT, type Choice, type FormRules, type VersionStamp } from "./routine";

export type YesNo = "yes" | "no";
export const YES_NO: readonly YesNo[] = ["yes", "no"];
export type Sleep = "good" | "ok" | "poor";
export const SLEEPS: readonly Sleep[] = ["good", "ok", "poor"];

/** "More reflections" holds more than the other boxes (characters). */
export const MAX_REFLECTIONS = 20000;

/** Every answer, in the order she meets them (all optional). */
export interface WeeklyReviewFields {
  selfHarm: YesNo | null;
  selfHarmWhat: string;
  urges: YesNo | null;
  urgesNote: string;
  fight: YesNo | null;
  fightAbout: string;
  fightTrigger: string;
  fightResolved: string;
  productive: Choice | null;
  achieved: string;
  struggled: string;
  well: string;
  inWay: string;
  /** "Am I living my values?" 1 to 10, or not answered. */
  values: number | null;
  ifThen: string;
  /** The days of next week she expects to be minimum days (Monday first). */
  minDays: Weekday[];
  dbt: string;
  sleep: Sleep | null;
  sleepNote: string;
  proud: string;
  more: string;
}

/** One sealed version (the same stamp as the daily log's and the first review's). */
export type WeeklyReviewEntry = VersionStamp & WeeklyReviewFields;

/** The written boxes, with the most each holds. */
export const WEEKLY_TEXTS = {
  selfHarmWhat: MAX_REVIEW_TEXT, urgesNote: MAX_REVIEW_TEXT, fightAbout: MAX_REVIEW_TEXT, fightTrigger: MAX_REVIEW_TEXT,
  fightResolved: MAX_REVIEW_TEXT, achieved: MAX_REVIEW_TEXT, struggled: MAX_REVIEW_TEXT, well: MAX_REVIEW_TEXT, inWay: MAX_REVIEW_TEXT,
  ifThen: MAX_REVIEW_TEXT, dbt: MAX_REVIEW_TEXT, sleepNote: MAX_REVIEW_TEXT, proud: MAX_REVIEW_TEXT, more: MAX_REFLECTIONS,
} as const satisfies Partial<Record<keyof WeeklyReviewFields, number>>;
type TextKey = keyof typeof WEEKLY_TEXTS;
const TEXT_KEYS = Object.keys(WEEKLY_TEXTS) as TextKey[];

export const EMPTY_WEEKLY_REVIEW: WeeklyReviewFields = {
  selfHarm: null, selfHarmWhat: "", urges: null, urgesNote: "", fight: null, fightAbout: "", fightTrigger: "", fightResolved: "",
  productive: null, achieved: "", struggled: "", well: "", inWay: "", values: null, ifThen: "", minDays: [],
  dbt: "", sleep: null, sleepNote: "", proud: "", more: "",
};

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const oneOf = (list: readonly string[]) => (v: unknown) => v === null || (isStr(v) && list.includes(v));
const tokens = (v: unknown) =>
  v === undefined || (Array.isArray(v) && v.length <= 64 && v.every((x) => isStr(x) && x.length <= 256));

/** A sealed version, as journal/routine.ts's VersionStamp plus every answer. */
export function isWeeklyReviewEntry(v: unknown): v is WeeklyReviewEntry {
  if (!isObj(v)) return false;
  const stampOk =
    v.v === 1 && (v.submittedAt === null || num(v.submittedAt)) && num(v.at) && tokens(v.seen) && tokens(v.settled) &&
    (v.doneOn === undefined || (isStr(v.doneOn) && /^\d{4}-\d{2}-\d{2}$/.test(v.doneOn)));
  return (
    stampOk &&
    TEXT_KEYS.every((k) => isStr(v[k]) && (v[k] as string).length <= WEEKLY_TEXTS[k]) &&
    oneOf(YES_NO)(v.selfHarm) && oneOf(YES_NO)(v.urges) && oneOf(YES_NO)(v.fight) &&
    oneOf(CHOICES)(v.productive) && oneOf(SLEEPS)(v.sleep) &&
    (v.values === null || (Number.isInteger(v.values) && (v.values as number) >= 1 && (v.values as number) <= 10)) &&
    Array.isArray(v.minDays) && v.minDays.length <= 7 && new Set(v.minDays).size === v.minDays.length &&
    v.minDays.every((d) => WEEKDAYS.includes(d as Weekday))
  );
}

/** Only the review's own answers (nothing else a version holds), days in week order. */
export function weeklyReviewFields(e: WeeklyReviewFields): WeeklyReviewFields {
  const out = { ...EMPTY_WEEKLY_REVIEW };
  for (const k of TEXT_KEYS) out[k] = e[k];
  return {
    ...out, selfHarm: e.selfHarm, urges: e.urges, fight: e.fight, productive: e.productive, sleep: e.sleep, values: e.values,
    minDays: WEEKDAYS.filter((d) => e.minDays.includes(d)),
  };
}

/** Anything answered or written. */
export const weeklyReviewFilled = (f: WeeklyReviewFields): boolean =>
  TEXT_KEYS.some((k) => f[k].trim() !== "") ||
  [f.selfHarm, f.urges, f.fight, f.productive, f.sleep, f.values].some((x) => x !== null) || f.minDays.length > 0;

/** The same answers (two versions with these are one, as she sees it). */
export const weeklyReviewKey = (f: WeeklyReviewFields): string => {
  const n = weeklyReviewFields(f);
  return JSON.stringify([...TEXT_KEYS.map((k) => n[k].trim()), n.selfHarm, n.urges, n.fight, n.productive, n.sleep, n.values, n.minDays]);
};

export const WEEKLY_REVIEW_RULES: FormRules<WeeklyReviewFields> = { key: weeklyReviewKey, filled: weeklyReviewFilled, empty: EMPTY_WEEKLY_REVIEW };

// ---- the week ------------------------------------------------------------------------------------

const us = (d: ISODate) => `${d.slice(5, 7)}-${d.slice(8, 10)}-${d.slice(0, 4)}`;

/** "Weekly Review [MM-DD-YYYY-MM-DD-YYYY]", Monday to Sunday of the week `date` is in (Esme's format). */
export const reviewTitle = (date: ISODate): string => {
  const monday = mondayOf(date);
  return `Weekly Review [${us(monday)}-${us(addDays(monday, 6))}]`;
};

/**
 * The week the tab opens on (its Monday), for the app day `today` (3am rule): Friday to Sunday,
 * this week; Monday to Thursday, last week while last week's review isn't done, else this week.
 */
export function defaultReviewWeek(today: ISODate, lastWeekDone: boolean): ISODate {
  const thisWeek = mondayOf(today);
  const dow = new Date(`${today}T12:00:00`).getDay(); // 0 Sunday … 6 Saturday
  const early = dow >= 1 && dow <= 4;
  return early && !lastWeekDone ? addDays(thisWeek, -7) : thisWeek;
}

/** The other week she can switch to: this week and last week, each the other's. */
export const otherReviewWeek = (today: ISODate, shown: ISODate): ISODate => {
  const thisWeek = mondayOf(today);
  return shown === thisWeek ? addDays(thisWeek, -7) : thisWeek;
};
