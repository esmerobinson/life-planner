// What is inside a journal row once it is opened (only ever in memory). Each kind's shape
// is checked after decrypting: an entry that opens but is not a shape this version knows
// counts as "can't open" and is never overwritten.

import { isObj, isStr } from "../data/validate";

/** A day's morning pages. `text` is every finished page of the day; hidden for 4 weeks. */
export interface MorningEntry {
  v: 1;
  /** All finished pages of the day, oldest first (no rereading: locked until MORNING_LOCK_DAYS after the day). */
  text: string;
  /** How many pages were finished ("I'm done") that day. */
  pages: number;
  /** The page being written now (autosaved), until "I'm done". */
  draft?: string;
  /** Photos of handwritten pages: file ids of encrypted `files` rows. */
  photos: string[];
}

/** A day's check-in: the three prompts (fixed once started) and the answers. */
export interface CheckinEntry {
  v: 1;
  prompts: string[];
  /** One per prompt; null = skipped (or not reached yet). */
  answers: (string | null)[];
  /** The next question to show (prompts.length once finished). */
  step: number;
  finished: boolean;
}

export type EntryOf<K extends "morning" | "checkin"> = K extends "morning" ? MorningEntry : CheckinEntry;

const strList = (v: unknown) => Array.isArray(v) && v.every(isStr);

export function isMorningEntry(v: unknown): v is MorningEntry {
  return (
    isObj(v) && v.v === 1 && isStr(v.text) && Number.isInteger(v.pages) && (v.pages as number) >= 0 &&
    (v.draft === undefined || isStr(v.draft)) && strList(v.photos)
  );
}

export function isCheckinEntry(v: unknown): v is CheckinEntry {
  return (
    isObj(v) && v.v === 1 && strList(v.prompts) &&
    Array.isArray(v.answers) && v.answers.length === (v.prompts as string[]).length &&
    v.answers.every((a) => a === null || isStr(a)) &&
    Number.isInteger(v.step) && (v.step as number) >= 0 && (v.step as number) <= (v.prompts as string[]).length &&
    typeof v.finished === "boolean"
  );
}

export const ENTRY_CHECK = { morning: isMorningEntry, checkin: isCheckinEntry } as const;

/** A morning row counts for the star calendar once a page is finished or a photo added. */
export const morningDone = (e: MorningEntry) => e.pages > 0 || e.photos.length > 0;

/** Words in a text (for "N of 750 words"). */
export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * A finished typed page is hidden this many days from its date (Esme, journal round: "hidden
 * for 4 weeks, then readable"), then opens read-only in "Read back".
 */
export const MORNING_LOCK_DAYS = 28;

/** Three pages (the Artist's Way's rough count), shown as "N of 750 words". */
export const MORNING_WORDS = 750;
