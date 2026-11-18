// "Today's routine" on Home (Esme approved, 17 Nov 2026; her daily template in esmeworld-notes,
// "BPD and ADHD routine building"). Pure rules: no database import, so the change tracker and
// the sync engine can use the row check without a cycle.
//
// Stored in the synced `prefs` table as plain rows (the sync Worker accepts any `prefs` id and
// checks only "due"), one row per thing two devices might change at once, so last-write-wins
// per row never loses another step's edit or another step's tick:
//
//   routine-step:<stepId>        { title?, min?, order?, habitId?, removed? }
//     The ten default steps (d1…d10) exist without a row; a row overrides only the fields it
//     has. A step she adds has its own random id and a title. Removing writes `removed: true`
//     (sync never deletes). `habitId`: absent = never set (a link may be suggested), null =
//     she unlinked it (never suggested again), a string = linked to that habit.
//   routine-tick:<date>:<stepId> { date, step, done }
//     An unlinked step's tick for one day (the app day, 3am to 3am). A linked step has no tick
//     of its own: it is ticked exactly when its habit is done that day (doneDates). On a day its
//     habit isn't scheduled, it uses its own tick (no off-day session is logged for the habit).
//   routine-autolinked           {}
//     The keyword links were suggested once, on some device: never again, on any device.
//     Suggested links (and this marker) are stamped 1, so a real edit always wins over them.

import { doneToday, isHabit } from "./habits";
import { isValidISODate, weekdayOf } from "./dates";
import type { ISODate, Item } from "./types";

export const STEP_PREFIX = "routine-step:";
export const TICK_PREFIX = "routine-tick:";
/** The one-time marker: the keyword links have been suggested (on some device). */
export const AUTOLINK_ID = "routine-autolinked";
export const MAX_STEPS = 40;
export const MAX_STEP_TITLE = 120;
export const MAX_STEP_MIN = 200;
const STEP_ID = /^[a-z0-9]{1,24}$/;
const MAX_HABIT_ID = 128;

export const stepRowId = (stepId: string) => `${STEP_PREFIX}${stepId}`;
export const tickRowId = (date: ISODate, stepId: string) => `${TICK_PREFIX}${date}:${stepId}`;

/** A stored step row (only the fields that differ from the default, for a default step). */
export interface RoutineStepRow {
  id: string;
  title?: string;
  min?: string;
  order?: number;
  habitId?: string | null;
  removed?: boolean;
  updatedAt?: number;
}

/** An unlinked step's tick for one day. */
export interface RoutineTickRow {
  id: string;
  date: ISODate;
  step: string;
  done: boolean;
  updatedAt?: number;
}

export interface RoutineMarkerRow {
  id: typeof AUTOLINK_ID;
  updatedAt?: number;
}

export type RoutineRow = RoutineStepRow | RoutineTickRow | RoutineMarkerRow;

/** A step as shown. */
export interface RoutineStep {
  id: string;
  title: string;
  /** The minimum version (still counts fully). */
  min: string;
  order: number;
  habitId: string | null | undefined;
}

/**
 * Her ten steps (wording from the brief, 17 Nov 2026; PROVISIONAL, for Esme and the Design
 * session to reword). Wake window 8–9am.
 */
export const DEFAULT_STEPS: readonly { id: string; title: string; min: string; keywords: readonly string[] }[] = [
  { id: "d1", title: "Up between 8 and 9am", min: "out of bed in that window, even after a bad night", keywords: ["up by", "wake"] },
  { id: "d2", title: "5-minute meditation", min: "three slow breaths on the edge of the bed", keywords: ["meditat"] },
  { id: "d3", title: "Daylight: outside or by the brightest window", min: "curtains open, tea by the window", keywords: ["light"] },
  { id: "d4", title: "Vitamins with morning tea", min: "vitamins", keywords: ["vitamin"] },
  { id: "d5", title: "One workbook card", min: "just the check-in", keywords: [] },
  { id: "d6", title: "Book: 30+ minutes, end with \"Next: …\"", min: "15 minutes, or one paragraph written badly on purpose", keywords: [] },
  { id: "d7", title: "Today's lane (content, art or business)", min: "one small step in that lane", keywords: [] },
  { id: "d8", title: "After lunch: 1–2 more workbook cards", min: "skip, the morning one counts", keywords: [] },
  {
    id: "d9", title: "Wind down: screens down, evening check-in, glance at tomorrow's \"Next:\"", min: "one line in the journal",
    keywords: ["wind down", "wind-down"],
  },
  { id: "d10", title: "Bed", min: "bed", keywords: [] },
];
const DEFAULT_BY_ID = new Map(DEFAULT_STEPS.map((d, i) => [d.id, { ...d, order: i + 1 }] as const));
export const isDefaultStep = (stepId: string) => DEFAULT_BY_ID.has(stepId);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStamp = (v: unknown) => v === undefined || (typeof v === "number" && Number.isSafeInteger(v) && v >= 0);
const isTitle = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && v.length <= MAX_STEP_TITLE;
const isMin = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_STEP_MIN;

/** One routine row is well formed (sync, local writes). Unknown fields are allowed (later versions). */
export function validRoutineRow(r: unknown): r is RoutineRow {
  if (!isObj(r) || typeof r.id !== "string" || !isStamp(r.updatedAt)) return false;
  if (r.id === AUTOLINK_ID) return true;
  if (r.id.startsWith(STEP_PREFIX)) {
    const stepId = r.id.slice(STEP_PREFIX.length);
    if (!STEP_ID.test(stepId)) return false;
    if (r.title !== undefined && !isTitle(r.title)) return false;
    if (r.min !== undefined && !isMin(r.min)) return false;
    if (r.order !== undefined && !(typeof r.order === "number" && Number.isFinite(r.order))) return false;
    if (r.habitId !== undefined && r.habitId !== null && !(typeof r.habitId === "string" && r.habitId !== "" && r.habitId.length <= MAX_HABIT_ID)) return false;
    if (r.removed !== undefined && typeof r.removed !== "boolean") return false;
    // A step she added has no default to fall back on: it needs its title (unless removed).
    if (!isDefaultStep(stepId) && r.removed !== true && r.title === undefined) return false;
    return true;
  }
  if (r.id.startsWith(TICK_PREFIX)) {
    const { date, step, done } = r;
    if (typeof date !== "string" || !isValidISODate(date)) return false;
    if (typeof step !== "string" || !STEP_ID.test(step)) return false;
    if (typeof done !== "boolean") return false;
    return r.id === tickRowId(date, step);
  }
  return false;
}

/** Is a `prefs` row id one of the routine's? */
export const isRoutineRowId = (id: unknown): boolean =>
  typeof id === "string" && (id.startsWith(STEP_PREFIX) || id.startsWith(TICK_PREFIX) || id === AUTOLINK_ID);

/** The steps as shown: the defaults with their stored overrides, plus steps she added; in order. */
export function routineSteps(rows: readonly RoutineStepRow[]): RoutineStep[] {
  const stored = new Map(rows.filter((r) => r.id.startsWith(STEP_PREFIX)).map((r) => [r.id.slice(STEP_PREFIX.length), r] as const));
  const ids = new Set([...DEFAULT_BY_ID.keys(), ...stored.keys()]);
  const out: RoutineStep[] = [];
  for (const id of ids) {
    const row = stored.get(id);
    if (row?.removed === true) continue;
    const def = DEFAULT_BY_ID.get(id);
    const title = row?.title ?? def?.title;
    if (title === undefined) continue;
    out.push({
      id,
      title,
      min: row?.min ?? def?.min ?? "",
      order: row?.order ?? def?.order ?? DEFAULT_STEPS.length + 1,
      habitId: row && "habitId" in row ? row.habitId : undefined,
    });
  }
  return out.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** A habit a step can link to: a live recurring to-do. */
export const isLinkableHabit = (it: Item) => isHabit(it) && it.status === "open";

/** Every day of the week: the only habits a step is ever linked to automatically. */
export const isDailyHabit = (it: Item) => isLinkableHabit(it) && new Set(it.recur).size === 7;

/** A linked habit counts for the step on `day` only when it is scheduled that day. */
const scheduledOn = (it: Item, day: ISODate) => it.recur?.includes(weekdayOf(day)) ?? false;

/**
 * Links to suggest (once: the caller checks the marker): for each default step with NO stored
 * row (never renamed, linked, unlinked or removed, here or synced from her other device), the
 * first live daily habit whose title has one of its keywords, never a habit any stored row
 * holds (a removed step's too) nor one already suggested. Never makes a habit.
 */
export function suggestLinks(rows: readonly RoutineStepRow[], items: readonly Item[]): { stepId: string; habitId: string }[] {
  const habits = items.filter(isDailyHabit).sort((a, b) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1));
  const stored = rows.filter((r) => r.id.startsWith(STEP_PREFIX));
  const has = new Set(stored.map((r) => r.id.slice(STEP_PREFIX.length)));
  const taken = new Set(stored.map((r) => r.habitId).filter((h): h is string => typeof h === "string"));
  const out: { stepId: string; habitId: string }[] = [];
  for (const def of DEFAULT_STEPS) {
    if (has.has(def.id) || def.keywords.length === 0) continue;
    const h = habits.find((it) => !taken.has(it.id) && def.keywords.some((k) => it.title.toLowerCase().includes(k)));
    if (!h) continue;
    taken.add(h.id);
    out.push({ stepId: def.id, habitId: h.id });
  }
  return out;
}

export interface RoutineRowView {
  step: RoutineStep;
  /** The live habit it is linked to (undefined: unlinked, the habit is gone, or not scheduled today). */
  habit?: Item;
  done: boolean;
}

export interface RoutineDay {
  rows: RoutineRowView[];
  done: number;
  total: number;
}

/** The routine on `today`: each step ticked or not (a linked step by its habit). */
export function routineDay(steps: readonly RoutineStep[], items: readonly Item[], ticks: readonly RoutineTickRow[], today: ISODate): RoutineDay {
  const own = new Map(ticks.filter((t) => t.date === today).map((t) => [t.step, t.done] as const));
  const byId = new Map(items.map((it) => [it.id, it] as const));
  const rows = steps.map((step): RoutineRowView => {
    const h = typeof step.habitId === "string" ? byId.get(step.habitId) : undefined;
    const habit = h && isLinkableHabit(h) && scheduledOn(h, today) ? h : undefined;
    return { step, ...(habit ? { habit } : {}), done: habit ? doneToday(habit, today) : own.get(step.id) === true };
  });
  return { rows, done: rows.filter((r) => r.done).length, total: rows.length };
}

/**
 * The step to highlight: the first unticked one after the last ticked one (so a step she
 * skipped never stays highlighted all day), else the first unticked one; null when all done.
 */
export function nextStepId(rows: readonly RoutineRowView[]): string | null {
  let last = -1;
  rows.forEach((r, i) => {
    if (r.done) last = i;
  });
  const after = rows.slice(last + 1).find((r) => !r.done);
  return (after ?? rows.find((r) => !r.done))?.step.id ?? null;
}
