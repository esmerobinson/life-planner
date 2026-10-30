// The row validators: the backup file's rules for one item or goal. The same functions
// check rows from the sync server AND every local write (data/changeTracking.ts), so the
// app can never store or send a row another device would refuse.
// No database import here, so the change tracker can use it without an import cycle.

import { isValidISODate } from "../domain/dates";
import { MAX_DONE_DATES } from "../domain/habits";
import { AREA_IDS, JOURNAL_KINDS, SOURCE_KINDS, WEEKDAYS, type FileRow, type Goal, type Item, type JournalRow } from "../domain/types";

/** The longest goal why / cadence text (characters). */
export const MAX_GOAL_TEXT = 4000;
/**
 * The most the page editor lets anyone type into a task's or idea's page. Item notes have
 * never had a validator cap and still don't, so no existing row can become invalid.
 */
export const MAX_NOTES_TEXT = 20_000;
/**
 * The longest page (notes) a goal may hold. Stays at 4000 in round 3b: a pre-3b device
 * refuses a longer goal and could then overwrite it with its older copy.
 * TODO(after every device runs 3b): raise to MAX_NOTES_TEXT (validator, repo and editor).
 */
export const MAX_GOAL_NOTES = 4000;

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
    optText(r.why) && optText(r.cadence) &&
    (r.notes === undefined || (isStr(r.notes) && r.notes.length <= MAX_GOAL_NOTES)) &&
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

/** Picture types a file row may hold (the app writes JPEG; the others are accepted for later). */
export const FILE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
/**
 * The most base64 text one picture may hold. The app keeps pictures under 700 KB of JPEG
 * (about 933,000 base64 characters); this leaves room under the sync server's 1 MB row cap.
 */
export const MAX_FILE_DATA = 960_000;
/** The largest width or height a picture row may claim (pixels). */
const MAX_FILE_SIDE = 20_000;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const side = (v: unknown, min: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= MAX_FILE_SIDE;

/** One file (picture) row is valid (backup, sync, local writes). */
export function validFile(r: unknown): r is FileRow {
  if (!isObj(r)) return false;
  const purged = r.status === "purged";
  return (
    isStr(r.id) && r.id !== "" &&
    isStr(r.mime) && (FILE_MIMES as readonly string[]).includes(r.mime) &&
    isStr(r.data) && r.data.length <= MAX_FILE_DATA && r.data.length % 4 === 0 && BASE64.test(r.data) &&
    isStr(r.createdAt) && isValidISODate(r.createdAt) &&
    (r.status === undefined || purged) &&
    // A live picture has pixels; a purged tombstone has no data and no size.
    (purged
      ? r.data === "" && r.width === 0 && r.height === 0
      : r.data !== "" && side(r.width, 1) && side(r.height, 1)) &&
    // A journal photo (sealed with the journal key) carries its IV; a plain picture has neither.
    ((r.encrypted === undefined && r.iv === undefined && r.fp === undefined) ||
      (r.encrypted === true && !purged && validIv(r.iv) && (r.fp === undefined || validFp(r.fp)))) &&
    optStamp(r.updatedAt)
  );
}

/** A key fingerprint: 16 lowercase hex characters. */
const validFp = (v: unknown) => isStr(v) && /^[0-9a-f]{16}$/.test(v);

/** Base64 of a 12-byte AES-GCM IV (always 16 characters, no padding). */
const IV = /^[A-Za-z0-9+/]{16}$/;
const validIv = (v: unknown) => isStr(v) && IV.test(v);
/** The most base64 ciphertext one journal entry may hold (the same room as a picture). */
export const MAX_JOURNAL_CT = MAX_FILE_DATA;
const JOURNAL_KEYS = new Set(["id", "kind", "date", "fp", "iv", "ct", "updatedAt"]);
const JOURNAL_KIND_LIST: readonly string[] = JOURNAL_KINDS;
/** The part after `<kind>:<date>:` in a part id (a uuid, file id, device id or prompt id). */
const SUFFIX = /^[A-Za-z0-9_-]{1,64}$/;
/** A per-device answer's suffix: `<12 hex promptKey>:<deviceId>`. */
const ANSWER_SUFFIX = /^[0-9a-f]{12}:[A-Za-z0-9_-]{8,64}$/;

/** A journal row's id for its kind, day and (for parts) suffix. */
export function journalId(kind: JournalRow["kind"], date: string, suffix?: string): string {
  switch (kind) {
    case "settings":
    case "verifier":
      return kind;
    case "set":
    case "morning":
    case "checkin":
      return `${kind}:${date}`;
    default:
      return `${kind}:${date}:${suffix ?? ""}`;
  }
}

/** The id rule for one row: the id matches its kind and day (and a part has a plain suffix). */
function validJournalId(kind: JournalRow["kind"], date: string, id: string): boolean {
  if (["page", "photo", "draft", "answer"].includes(kind)) {
    const prefix = `${kind}:${date}:`;
    if (!id.startsWith(prefix)) return false;
    const rest = id.slice(prefix.length);
    // An answer is per device and names its prompt only by an opaque key:
    // `answer:<date>:<12 hex promptKey>:<deviceId>` (the earlier shared `answer:<date>:<promptId>` still reads).
    if (kind === "answer" && ANSWER_SUFFIX.test(rest)) return true;
    return SUFFIX.test(rest);
  }
  return id === journalId(kind, date);
}

/**
 * One journal row is valid (backup, sync, local writes). Nothing but the sealed entry and
 * its clear kind/date/id/fingerprint may be in it: any other field (say, plaintext by
 * mistake) makes the row invalid, so it is never stored or sent. Every new row carries the
 * fingerprint of the key that sealed it; only the earlier one-row-per-day shape may lack it.
 */
export function validJournal(r: unknown): r is JournalRow {
  return (
    isObj(r) &&
    Object.keys(r).every((k) => JOURNAL_KEYS.has(k)) &&
    isStr(r.kind) && JOURNAL_KIND_LIST.includes(r.kind) &&
    isStr(r.date) && isValidISODate(r.date) &&
    isStr(r.id) && validJournalId(r.kind as JournalRow["kind"], r.date, r.id) &&
    (r.kind === "morning" || r.kind === "checkin" ? r.fp === undefined || validFp(r.fp) : validFp(r.fp)) &&
    validIv(r.iv) &&
    isStr(r.ct) && r.ct !== "" && r.ct.length <= MAX_JOURNAL_CT && r.ct.length % 4 === 0 && BASE64.test(r.ct) &&
    optStamp(r.updatedAt)
  );
}
