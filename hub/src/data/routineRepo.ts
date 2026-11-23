// The daily log's and the weekly review's reads and writes (Esme's routine plan, 16 Nov 2026).
// Sealed journal rows ("day-log", "week-review"), written only through journalRepo's write (the
// confirmed-key gate), like every journal kind.
//
// The learned-words pattern (journalRepo "learned"), for a form of a few answers:
// - Each row is one VERSION: `<kind>:<date>:<deviceId>_<vid>`. A box session (from the first
//   change to a box with nothing unsaved) writes one new version and rewrites only that row while
//   she goes on; it names the versions she had in front of her (`seen`), and replaces only those.
//   No device ever writes over another device's row, and nothing is ever cleared silently: another
//   device's version she never saw stays, listed under the box, until she uses or removes it.
// - Done (`submittedAt`) is kept by every later edit of that version.
// - Device ids: always this device's current id (restore-safe, bug #31); a session row under a
//   former id is never written again, its answers move into a new version that replaces it.
// - The daily log is per day. The weekly review is per week (Monday to Sunday): its versions are
//   filed under the day each was first written, and an edit stays on its version's day.

import { db } from "./db";
import { CANT_OPEN, formRows, type FormKind } from "./journalRepo";
import { journalId } from "./validate";
import { ownDevices } from "./deviceIds";
import { addDays, mondayOf, todayISO } from "../domain/dates";
import type { ISODate, JournalRow } from "../domain/types";
import type { JournalKey } from "../journal/crypto";
import {
  DAY_LOG_RULES, MAX_LOG_NOTE, MAX_REVIEW_TEXT, mergeVersions, seenToken, WEEK_REVIEW_RULES, dayLogFields, weekReviewFields,
  type DayLogFields, type FormDay, type FormRules, type FormVersion, type RawVersion, type WeekReviewFields,
} from "../journal/routine";
import { WEEKLY_REVIEW_RULES, WEEKLY_TEXTS, weeklyReviewFields, type WeeklyReviewFields } from "../journal/weeklyReview";

export type { DayLogFields, FormDay, FormVersion, WeekReviewFields, WeeklyReviewFields };

/** Thrown for answers longer than a box holds. */
export const TOO_LONG = "That's too long to save. Nothing was changed.";

/** What a box session writes: its day, its own row once it has one, what it replaces, and Done. */
export interface FormSession {
  date: ISODate;
  version?: string;
  seen: string[];
  submittedAt: number | null;
  /** The app day she pressed Done (kept from the version she edits). */
  doneOn?: ISODate | null;
  /** Versions she chose not to use: kept listed, not holding the day (journal/routine.ts). */
  settled?: string[];
}

type Spec<F> = { kind: FormKind; rules: FormRules<F>; fields: (e: never) => F; tooLong: (f: F) => boolean };

const DAY_LOG: Spec<DayLogFields> = {
  kind: "day-log",
  rules: DAY_LOG_RULES,
  fields: dayLogFields as (e: never) => DayLogFields,
  tooLong: (f) => f.scheduleNote.length > MAX_LOG_NOTE || f.todosNote.length > MAX_LOG_NOTE,
};
const WEEK_REVIEW: Spec<WeekReviewFields> = {
  kind: "week-review",
  rules: WEEK_REVIEW_RULES,
  fields: weekReviewFields as (e: never) => WeekReviewFields,
  tooLong: (f) => [f.well, f.inWay, f.ifThen].some((t) => t.length > MAX_REVIEW_TEXT),
};

const WEEKLY_REVIEW: Spec<WeeklyReviewFields> = {
  kind: "weekly-review",
  rules: WEEKLY_REVIEW_RULES,
  fields: weeklyReviewFields as (e: never) => WeeklyReviewFields,
  tooLong: (f) => (Object.keys(WEEKLY_TEXTS) as (keyof typeof WEEKLY_TEXTS)[]).some((k) => f[k].length > WEEKLY_TEXTS[k]),
};

const suffixOf = (row: JournalRow) => row.id.slice(`${row.kind}:${row.date}:`.length);
const deviceOf = (row: JournalRow) => {
  const s = suffixOf(row);
  const cut = s.lastIndexOf("_");
  return cut > 0 ? s.slice(0, cut) : s;
};

async function merged<F>(jk: JournalKey, spec: Spec<F>, rows: JournalRow[]): Promise<FormDay<F>> {
  const versions: RawVersion<F>[] = [];
  let unreadable = 0;
  for (const row of rows) {
    const o = await formRows.open(jk, row, spec.kind);
    if (o.state !== "ok") {
      unreadable++;
      continue;
    }
    const e = o.entry;
    versions.push({
      id: row.id, date: row.date, device: deviceOf(row), fields: spec.fields(e as never),
      submittedAt: e.submittedAt, ...(e.doneOn ? { doneOn: e.doneOn } : {}), at: e.at, seen: e.seen ?? [], settled: e.settled ?? [],
    });
  }
  return mergeVersions(versions, unreadable, spec.rules);
}

const rowsOf = (kind: FormKind) => db.journal.where("kind").equals(kind).toArray();
const shows = <F>(d: FormDay<F>, rules: FormRules<F>) => rules.filled(d.fields) || d.others.length > 0;

/** A new version's row id for this device. */
function newVersionId(kind: FormKind, date: ISODate, device: string): string {
  const vid = `${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36)}`;
  return journalId(kind, date, `${device}_${vid}`);
}

async function wontOpen(jk: JournalKey, kind: FormKind, id: string): Promise<boolean> {
  const row = await db.journal.get(id);
  return !!row && (await formRows.open(jk, row, kind)).state !== "ok";
}

async function atOf(jk: JournalKey, kind: FormKind, id: string): Promise<number | null> {
  const row = await db.journal.get(id);
  const o = row ? await formRows.open(jk, row, kind) : null;
  return o?.state === "ok" ? o.entry.at : null;
}

/**
 * Saves the box's answers as the session's version (its own row, or a new one), replacing only
 * what the session names. `submit`: Done (kept from then on). Returns the version's row id.
 */
async function saveForm<F extends object>(
  jk: JournalKey, spec: Spec<F>, deviceId: string, fields: F, session: FormSession, submit: boolean,
): Promise<string> {
  if (spec.tooLong(fields)) throw new Error(TOO_LONG);
  const { kind } = spec;
  const date = session.date;
  const { current: device, former } = await ownDevices(deviceId);
  const own = (id: string) => id.startsWith(`${kind}:${date}:${device}_`);
  const v = session.version;
  const carry = !!v && !own(v) && former.some((f) => v.startsWith(`${kind}:${date}:${f}_`));
  if (v && !own(v) && !carry) throw new Error("Only this device's own version can be changed here.");
  const id = v && own(v) ? v : newVersionId(kind, date, device);
  if (await wontOpen(jk, kind, id)) throw new Error(CANT_OPEN); // never written over (bug #20)
  // A session row under a former id is replaced only as it is here now (bug #60).
  const carriedAt = carry ? await atOf(jk, kind, v!) : null;
  const carried = carriedAt === null ? [] : [seenToken({ id: v!, at: carriedAt })];
  // Kept in the session: every later save of the new row still replaces the old one (review M1).
  for (const t of carried) if (!session.seen.includes(t)) session.seen.push(t);
  const seen = [...session.seen, ...carried].filter((x) => x !== id && !x.startsWith(`${id}@`));
  const settled = (session.settled ?? []).filter((x) => x !== id && !x.startsWith(`${id}@`)).slice(0, 64);
  // Strictly newer than this row's previous write, so a version hidden as <id>@<at> shows again once
  // written to; and strictly newer than every version it names (replaces or settles), so which one
  // shows never depends on the clock (two writes in the same millisecond sorted by a random id).
  const prevAt = (await atOf(jk, kind, id)) ?? 0;
  let named = 0;
  for (const t of [...seen, ...settled]) {
    const cut = t.lastIndexOf("@");
    const stamp = cut > 0 ? Number(t.slice(cut + 1)) : NaN;
    const at = Number.isFinite(stamp) ? stamp : ((await atOf(jk, kind, t)) ?? 0);
    if (at > named) named = at;
  }
  const at = Math.max(Date.now(), prevAt + 1, named + 1);
  const submittedAt = submit ? (session.submittedAt ?? at) : session.submittedAt;
  // The day she pressed Done: kept from the version she edits, else today in the app (3am rule).
  const doneOn = submittedAt === null ? null : (session.doneOn ?? (session.submittedAt === null ? todayISO(new Date(at)) : todayISO(new Date(session.submittedAt))));
  if (submittedAt !== null) session.doneOn = doneOn;
  const entry = {
    v: 1, ...spec.fields(fields as never), submittedAt, ...(doneOn ? { doneOn } : {}), at,
    ...(seen.length ? { seen } : {}), ...(settled.length ? { settled } : {}),
  };
  await formRows.write(jk, kind, [await formRows.seal(jk, kind, date, id.slice(`${kind}:${date}:`.length), entry)]);
  return id;
}

/**
 * Removes one version she confirmed: a new, empty version from this device (at 0, so it never
 * shows over other answers) that replaces only that version (and any with the same answers).
 */
async function removeForm<F>(jk: JournalKey, spec: Spec<F>, deviceId: string, version: FormVersion<F>): Promise<string> {
  if (!version.id || version.seen.length === 0) return "";
  const { current: device } = await ownDevices(deviceId);
  const id = newVersionId(spec.kind, version.date, device);
  const entry = { v: 1, ...spec.fields(spec.rules.empty as never), submittedAt: null, at: 0, seen: version.seen };
  await formRows.write(jk, spec.kind, [await formRows.seal(jk, spec.kind, version.date, id.slice(`${spec.kind}:${version.date}:`.length), entry)]);
  return id;
}

// ---- the daily log ------------------------------------------------------------------------------

/** A day's daily log: the newest version, and every other one not replaced. */
export async function readDayLog(jk: JournalKey, date: ISODate): Promise<FormDay<DayLogFields>> {
  return merged(jk, DAY_LOG, (await db.journal.where("date").equals(date).toArray()).filter((r) => r.kind === "day-log"));
}

/** Every day with a daily log before `before`, newest first (empty days left out). */
export async function listDayLogs(jk: JournalKey, before: ISODate): Promise<({ date: ISODate } & FormDay<DayLogFields>)[]> {
  const rows = (await rowsOf("day-log")).filter((r) => r.date < before);
  const out: ({ date: ISODate } & FormDay<DayLogFields>)[] = [];
  for (const date of [...new Set(rows.map((r) => r.date))].sort((a, b) => b.localeCompare(a))) {
    const day = await merged(jk, DAY_LOG, rows.filter((r) => r.date === date));
    if (shows(day, DAY_LOG.rules)) out.push({ ...day, date });
  }
  return out;
}

export const saveDayLog = (jk: JournalKey, deviceId: string, fields: DayLogFields, session: FormSession, submit = false) =>
  saveForm(jk, DAY_LOG, deviceId, fields, session, submit);

export const removeDayLogVersion = (jk: JournalKey, deviceId: string, version: FormVersion<DayLogFields>) =>
  removeForm(jk, DAY_LOG, deviceId, version);

// ---- the weekly review --------------------------------------------------------------------------

/** The week (Monday to Sunday) a day is in, by its Monday. */
export const weekOf = (date: ISODate): ISODate => mondayOf(date);

/** The review of the week `date` is in: the newest version, and every other one not replaced. */
export async function readWeekReview(jk: JournalKey, date: ISODate): Promise<FormDay<WeekReviewFields>> {
  const monday = weekOf(date);
  const sunday = addDays(monday, 6);
  const rows = (await db.journal.where("date").between(monday, sunday, true, true).toArray()).filter((r) => r.kind === "week-review");
  return merged(jk, WEEK_REVIEW, rows);
}

/** Every week with a review written before `before`, by its Monday, newest first (empty weeks left out). */
export async function listWeekReviews(jk: JournalKey, before: ISODate): Promise<({ week: ISODate } & FormDay<WeekReviewFields>)[]> {
  const rows = (await rowsOf("week-review")).filter((r) => r.date < before);
  const out: ({ week: ISODate } & FormDay<WeekReviewFields>)[] = [];
  for (const week of [...new Set(rows.map((r) => weekOf(r.date)))].sort((a, b) => b.localeCompare(a))) {
    const day = await merged(jk, WEEK_REVIEW, rows.filter((r) => weekOf(r.date) === week));
    if (shows(day, WEEK_REVIEW.rules)) out.push({ ...day, week });
  }
  return out;
}

export const saveWeekReview = (jk: JournalKey, deviceId: string, fields: WeekReviewFields, session: FormSession, submit = false) =>
  saveForm(jk, WEEK_REVIEW, deviceId, fields, session, submit);

export const removeWeekReviewVersion = (jk: JournalKey, deviceId: string, version: FormVersion<WeekReviewFields>) =>
  removeForm(jk, WEEK_REVIEW, deviceId, version);

// ---- the weekly review v2 (its own tab; journal/weeklyReview.ts) ---------------------------------

/** A week's v2 review (by its Monday): the newest version, and every other one not replaced. */
export async function readWeeklyReview(jk: JournalKey, monday: ISODate): Promise<FormDay<WeeklyReviewFields>> {
  return merged(jk, WEEKLY_REVIEW, (await db.journal.where("date").equals(monday).toArray()).filter((r) => r.kind === "weekly-review"));
}

/** Every week with a v2 review, by its Monday, newest first (empty weeks left out). */
export async function listWeeklyReviews(jk: JournalKey): Promise<({ week: ISODate } & FormDay<WeeklyReviewFields>)[]> {
  const rows = await rowsOf("weekly-review");
  const out: ({ week: ISODate } & FormDay<WeeklyReviewFields>)[] = [];
  for (const week of [...new Set(rows.map((r) => r.date))].sort((a, b) => b.localeCompare(a))) {
    const day = await merged(jk, WEEKLY_REVIEW, rows.filter((r) => r.date === week));
    if (shows(day, WEEKLY_REVIEW.rules)) out.push({ ...day, week });
  }
  return out;
}

/** Only ever filed under the week's Monday (the week is chosen, so the day written can't say it). */
export async function saveWeeklyReview(jk: JournalKey, deviceId: string, fields: WeeklyReviewFields, session: FormSession, submit = false): Promise<string> {
  if (weekOf(session.date) !== session.date) throw new Error("A weekly review is filed under its week's Monday.");
  return saveForm(jk, WEEKLY_REVIEW, deviceId, fields, session, submit);
}

export const removeWeeklyReviewVersion = (jk: JournalKey, deviceId: string, version: FormVersion<WeeklyReviewFields>) =>
  removeForm(jk, WEEKLY_REVIEW, deviceId, version);

// ---- both kinds of weekly review, together ---------------------------------------------------------

/**
 * One week's reviews: the v2 one and the earlier one (either, both or, never, neither). `day`: the
 * one day the week counts as Mental health work (null: neither is done). Old and new never count
 * twice: a done v2 review is the week's, else a done earlier one.
 */
export interface ReviewWeek {
  week: ISODate;
  v2?: FormDay<WeeklyReviewFields>;
  v1?: FormDay<WeekReviewFields>;
  day: ISODate | null;
}

/** Every week with a review of either kind, by its Monday, newest first. */
export async function listReviewWeeks(jk: JournalKey, before: ISODate = "9999-12-31"): Promise<ReviewWeek[]> {
  const byWeek = new Map<ISODate, ReviewWeek>();
  const at = (week: ISODate) => byWeek.get(week) ?? (byWeek.set(week, { week, day: null }), byWeek.get(week)!);
  for (const r of await listWeeklyReviews(jk)) if (r.week < before) at(r.week).v2 = r;
  for (const r of await listWeekReviews(jk, before)) at(r.week).v1 = r;
  for (const w of byWeek.values()) {
    const counts = w.v2?.done ? w.v2 : w.v1?.done ? w.v1 : null;
    w.day = counts ? counts.day : null;
  }
  return [...byWeek.values()].sort((a, b) => b.week.localeCompare(a.week));
}

/** Whether the week (by its Monday) has a done review of either kind. */
export async function reviewWeekDone(jk: JournalKey, monday: ISODate): Promise<boolean> {
  return (await listReviewWeeks(jk)).some((w) => w.week === monday && w.day !== null);
}

/**
 * The days a weekly review was done (Done pressed, something answered): Mental health work, like a
 * card done (the Journal's green row, its week bars, the farm). One per week, whichever kind: the
 * day she pressed Done.
 */
export async function reviewDoneDays(jk: JournalKey): Promise<Set<ISODate>> {
  const out = new Set<ISODate>();
  for (const w of await listReviewWeeks(jk)) if (w.day) out.add(w.day);
  return out;
}
