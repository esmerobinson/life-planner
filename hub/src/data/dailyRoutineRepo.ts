// "Today's routine" on Home: reads and writes. The rows and their rules are in
// domain/dailyRoutine.ts; they live in the synced `prefs` table.
//
// Every edit reads the NEWEST row and changes only the fields it means to, in one transaction
// (like the Due settings, reminders/dueSettings.ts), so an edit never writes an old copy over a
// change another device made since. A linked step's tick is the habit's own tick (tickItem /
// untickItem), so the habit's history, Together, the farm and Due see exactly what ticking the
// habit does.

import { db, type HubDB } from "./db";
import { keepOwnStamps } from "./changeTracking";
import { tickItem, untickItem } from "./repo";
import {
  AUTOLINK_ID, MAX_STEP_MIN, isDailyHabit, MAX_STEP_TITLE, MAX_STEPS, STEP_PREFIX, TICK_PREFIX, isDefaultStep, routineDay, routineSteps,
  stepRowId, suggestLinks, tickRowId, type RoutineStepRow, type RoutineTickRow,
} from "../domain/dailyRoutine";
import type { ISODate } from "../domain/types";

/** When this app session started: suggested links wait for a sync that finished after it. */
export const SESSION_STARTED_AT = Date.now();
/** The stamp of a suggested link and of the marker: older than any real edit on any device. */
const SUGGESTED_STAMP = 1;

/** Thrown for a step with no title, or words longer than a box holds. */
export const STEP_NOT_SAVED = "A step needs a short title. Nothing was changed.";

const isStepRow = (r: { id: string }): r is RoutineStepRow => r.id.startsWith(STEP_PREFIX);

async function stepRows(d: HubDB = db): Promise<RoutineStepRow[]> {
  return (await d.prefs.where("id").startsWith(STEP_PREFIX).toArray()).filter(isStepRow);
}

/** The stored step rows, and the ticks of one day. */
export async function readRoutine(date: ISODate): Promise<{ steps: RoutineStepRow[]; ticks: RoutineTickRow[] }> {
  const [steps, ticks] = await Promise.all([
    stepRows(),
    db.prefs.where("id").startsWith(`${TICK_PREFIX}${date}:`).toArray() as Promise<RoutineTickRow[]>,
  ]);
  return { steps, ticks };
}

/** Writes a step's row: the newest stored row with `patch` over it (the stamp is set by the tracker). */
async function patchStep(stepId: string, patch: Omit<RoutineStepRow, "id" | "updatedAt">, d: HubDB = db): Promise<void> {
  const id = stepRowId(stepId);
  const stored = (await d.prefs.get(id)) as RoutineStepRow | undefined;
  const { updatedAt: _stamp, ...kept } = stored ?? { id };
  await d.prefs.put({ ...kept, ...patch, id });
}

/** Ticks or unticks a step for `date`: a linked step through its habit, else its own tick row. */
export async function setRoutineStepDone(stepId: string, date: ISODate, done: boolean): Promise<void> {
  const step = routineSteps(await stepRows()).find((s) => s.id === stepId);
  const linked = typeof step?.habitId === "string" ? await db.items.get(step.habitId) : undefined;
  // Exactly as the day's view decides it: a live habit scheduled that day.
  const habit = step && linked ? routineDay([step], [linked], [], date).rows[0]?.habit : undefined;
  if (habit) {
    await (done ? tickItem(habit.id, date) : untickItem(habit.id, date));
    return;
  }
  const row: RoutineTickRow = { id: tickRowId(date, stepId), date, step: stepId, done };
  await db.prefs.put(row);
}

const cleanTitle = (t: string) => {
  const title = t.trim();
  if (title === "" || title.length > MAX_STEP_TITLE) throw new Error(STEP_NOT_SAVED);
  return title;
};
const cleanMin = (m: string) => {
  const min = m.trim();
  if (min.length > MAX_STEP_MIN) throw new Error(STEP_NOT_SAVED);
  return min;
};

/** Renames a step or changes its minimum. */
export async function updateRoutineStep(stepId: string, change: { title?: string; min?: string }, d: HubDB = db): Promise<void> {
  const patch = {
    ...(change.title !== undefined ? { title: cleanTitle(change.title) } : {}),
    ...(change.min !== undefined ? { min: cleanMin(change.min) } : {}),
  };
  await d.transaction("rw", d.prefs, () => patchStep(stepId, patch, d));
}

/**
 * Links a step to a habit (null: unlinked on purpose, never suggested again). A habit belongs to
 * one step: any other step linked to it is unlinked.
 */
export async function linkRoutineStep(stepId: string, habitId: string | null, d: HubDB = db): Promise<void> {
  await d.transaction("rw", d.prefs, async () => {
    if (habitId !== null) {
      for (const s of routineSteps(await stepRows(d))) if (s.id !== stepId && s.habitId === habitId) await patchStep(s.id, { habitId: null }, d);
    }
    await patchStep(stepId, { habitId }, d);
  });
}

/** Adds a step at the end; returns its id. */
export async function addRoutineStep(title: string, min = ""): Promise<string> {
  const t = cleanTitle(title);
  const m = cleanMin(min);
  return db.transaction("rw", db.prefs, async () => {
    const steps = routineSteps(await stepRows());
    if (steps.length >= MAX_STEPS) throw new Error(STEP_NOT_SAVED);
    let id: string;
    do id = `s${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36)}`.slice(0, 24);
    while (isDefaultStep(id) || (await db.prefs.get(stepRowId(id))));
    const order = Math.max(0, ...steps.map((s) => s.order)) + 1;
    await db.prefs.put({ id: stepRowId(id), title: t, min: m, order });
    return id;
  });
}

/** Removes a step (kept as removed: sync never deletes). Its ticks and its habit are untouched. */
export async function removeRoutineStep(stepId: string, d: HubDB = db): Promise<void> {
  await d.transaction("rw", d.prefs, () => patchStep(stepId, { removed: true }, d));
}

/** Moves a step one place up (-1) or down (1): only it and the step it swaps with are written. */
export async function moveRoutineStep(stepId: string, dir: -1 | 1): Promise<void> {
  await db.transaction("rw", db.prefs, async () => {
    const steps = routineSteps(await stepRows());
    const i = steps.findIndex((s) => s.id === stepId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= steps.length) return;
    const a = steps[i]!;
    const b = steps[j]!;
    if (a.order !== b.order) {
      await patchStep(a.id, { order: b.order });
      await patchStep(b.id, { order: a.order });
      return;
    }
    // Tied (two devices added steps at once): move this one just past the other.
    await patchStep(a.id, { order: b.order + dir * 0.5 });
  });
}

/**
 * Stores the suggested habit links (domain/dailyRoutine.ts suggestLinks), ONCE across her devices
 * (the `routine-autolinked` marker row). Returns how many it stored. Never creates a habit.
 * Her own choices always win (review I1):
 * - only steps with no row of their own get a link, and the links and the marker are stamped 1,
 *   so any real edit (a rename, an unlink, a removal), made on any device, beats them on sync;
 * - with sync set up, it waits until a sync has finished in this app session, so a device that
 *   updates (or was restored from a backup) sees her other device's routine first.
 * Nothing at all (not even the marker) until she has a daily habit to link.
 */
export async function applySuggestedLinks(d: HubDB = db): Promise<number> {
  return d.transaction("rw", [d.prefs, d.items, d.syncMeta], async () => {
    if (await d.prefs.get(AUTOLINK_ID)) return 0;
    const [token, firstPull, last] = await Promise.all([d.syncMeta.get("token"), d.syncMeta.get("firstPullDone"), d.syncMeta.get("lastSyncedAt")]);
    const syncedThisSession = firstPull?.value === true && typeof last?.value === "number" && last.value >= SESSION_STARTED_AT;
    if (token?.value && !syncedThisSession) return 0;
    const items = await d.items.toArray();
    if (!items.some(isDailyHabit)) return 0;
    const found = suggestLinks(await stepRows(d), items);
    keepOwnStamps(); // the rows below keep their stamp (1) and still go to the server
    await d.prefs.bulkPut([
      ...found.map(({ stepId, habitId }) => ({ id: stepRowId(stepId), habitId, updatedAt: SUGGESTED_STAMP })),
      { id: AUTOLINK_ID, updatedAt: SUGGESTED_STAMP },
    ]);
    return found.length;
  });
}
