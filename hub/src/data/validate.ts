// The row validators: the backup file's rules for one item or goal. The same functions
// check rows from the sync server AND every local write (data/changeTracking.ts), so the
// app can never store or send a row another device would refuse.
// No database import here, so the change tracker can use it without an import cycle.

import { isValidISODate } from "../domain/dates";
import { MAX_DONE_DATES } from "../domain/habits";
import { AREA_IDS, SOURCE_KINDS, WEEKDAYS, type Goal, type Item } from "../domain/types";

/** The longest goal why / cadence / notes text (characters). */
export const MAX_GOAL_TEXT = 4000;

const AREAS: readonly string[] = AREA_IDS;
const ITEM_KINDS = ["task", "idea"];
const STATUSES = ["open", "done", "archived", "deleted", "purged"];
const GOAL_KINDS = ["finite", "practice"];

export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export const isStr = (v: unknown): v is string => typeof v === "string";
const isStrArray = (v: unknown) => Array.isArray(v) && v.every(isStr);

/** One item row is valid (backup, sync, local writes). */
export function validItem(r: unknown): r is Item {
  return (
    isObj(r) &&
    isStr(r.id) && r.id !== "" &&
    ITEM_KINDS.includes(r.kind as string) &&
    isStr(r.title) &&
    isStrArray(r.links) &&
    AREAS.includes(r.areaId as string) &&
    (r.priority === 1 || r.priority === 2 || r.priority === 3) &&
    STATUSES.includes(r.status as string) &&
    isStr(r.createdAt) && isValidISODate(r.createdAt) &&
    isStr(r.touchedAt) && isValidISODate(r.touchedAt) &&
    optStr(r.notes) &&
    optStrArray(r.tags) &&
    optStr(r.goalId) &&
    optDate(r.due) &&
    (r.recur === undefined || (Array.isArray(r.recur) && r.recur.every((d) => WEEKDAY_LIST.includes(d as string)))) &&
    optDate(r.pinnedDate) &&
    optDate(r.weekOf) &&
    optDate(r.hiddenOn) &&
    optDate(r.completedAt) &&
    optDate(r.deletedAt) &&
    (r.milestone === undefined || typeof r.milestone === "boolean") &&
    (r.order === undefined || (typeof r.order === "number" && Number.isFinite(r.order))) &&
    (r.doneDates === undefined ||
      (Array.isArray(r.doneDates) &&
        r.doneDates.length <= MAX_DONE_DATES &&
        r.doneDates.every((d) => isStr(d) && isValidISODate(d)))) &&
    optStamp(r.updatedAt) &&
    validSource(r.source) &&
    // An emptied-from-the-Bin tombstone carries no content.
    (r.status !== "purged" ||
      (r.title === "" && r.notes === undefined && r.tags === undefined && (r.links as unknown[]).length === 0))
  );
}

/** One goal row is valid (backup, sync, local writes). */
export function validGoal(r: unknown): r is Goal {
  return (
    isObj(r) &&
    isStr(r.id) && r.id !== "" &&
    isStr(r.title) &&
    AREAS.includes(r.areaId as string) &&
    GOAL_KINDS.includes(r.kind as string) &&
    Array.isArray(r.milestones) &&
    r.milestones.every(
      (m) => isObj(m) && isStr(m.id) && isStr(m.title) && typeof m.done === "boolean",
    ) &&
    isStr(r.createdAt) && isValidISODate(r.createdAt) &&
    optDate(r.deadline) &&
    optText(r.why) && optText(r.cadence) && optText(r.notes) &&
    validGoalSource(r.source) &&
    optStamp(r.updatedAt) &&
    (r.status === undefined || r.status === "deleted" || r.status === "purged") &&
    optDate(r.deletedAt) &&
    // An emptied-from-the-Bin tombstone carries no content.
    (r.status !== "purged" ||
      (r.title === "" && r.why === undefined && r.cadence === undefined && r.notes === undefined &&
        (r.milestones as unknown[]).length === 0)) &&
    (r.monthlyTarget === undefined ||
      (typeof r.monthlyTarget === "number" && Number.isFinite(r.monthlyTarget) && r.monthlyTarget > 0))
  );
}

const WEEKDAY_LIST: readonly string[] = WEEKDAYS;
const SOURCE_LIST: readonly string[] = SOURCE_KINDS;
/** Absent, or a real "YYYY-MM-DD" date. */
const optDate = (v: unknown) => v === undefined || (isStr(v) && isValidISODate(v));
const optStr = (v: unknown) => v === undefined || isStr(v);
const optStrArray = (v: unknown) => v === undefined || isStrArray(v);
/** Absent, or a sync stamp (epoch ms). Restored rows are re-stamped on write anyway. */
const optStamp = (v: unknown) => v === undefined || (typeof v === "number" && Number.isSafeInteger(v) && v >= 0);

/** Absent, or a string of at most MAX_GOAL_TEXT characters. */
const optText = (v: unknown) => v === undefined || (isStr(v) && v.length <= MAX_GOAL_TEXT);

function validGoalSource(v: unknown) {
  if (v === undefined) return true;
  return isObj(v) && v.kind === "obsidian" && isStr(v.key);
}

function validSource(v: unknown) {
  if (v === undefined) return true;
  return isObj(v) && SOURCE_LIST.includes(v.kind as string) && isStr(v.key);
}
