// What is inside a journal row once it is opened (only ever in memory). Each kind's shape
// is checked after decrypting: a row that opens but is not a shape this version knows counts
// as "can't open" and is skipped on its own.

import { isObj, isStr } from "../data/validate";

/** One finished morning page ("I'm done"). Hidden for MORNING_LOCK_DAYS from its date. */
export interface PageEntry {
  v: 1;
  text: string;
  /** When it was finished (ms), to order a day's pages. */
  at: number;
}

/** One morning photo: the sealed image itself is the encrypted file row `fileId`. */
export interface PhotoEntry {
  v: 1;
  fileId: string;
  at: number;
}

/** The page being written on one device (empty once "I'm done"). */
export interface DraftEntry {
  v: 1;
  text: string;
}

/** One check-in answer. `done` once Next / Skip moved past it (else it is still being typed). */
export interface AnswerEntry {
  v: 1;
  prompt: string;
  answer: string | null;
  done: boolean;
  at: number;
}

/** The day's questions, written by the first device to open the check-in that day. */
export interface SetEntry {
  v: 1;
  prompts: string[];
  at: number;
}

/** Choose questions (synced). */
export interface SettingsEntry {
  v: 1;
  active: string[];
}

/** The earlier one-row-per-day morning shape (read and split; never written). */
export interface LegacyMorningEntry {
  v: 1;
  text: string;
  pages: number;
  draft?: string;
  photos: string[];
}

/** The earlier one-row-per-day check-in shape (read and split; never written). */
export interface LegacyCheckinEntry {
  v: 1;
  prompts: string[];
  answers: (string | null)[];
  step: number;
  finished: boolean;
}

const strList = (v: unknown) => Array.isArray(v) && v.every(isStr);
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);

export const ENTRY_CHECK = {
  page: (v: unknown): v is PageEntry => isObj(v) && v.v === 1 && isStr(v.text) && num(v.at),
  photo: (v: unknown): v is PhotoEntry => isObj(v) && v.v === 1 && isStr(v.fileId) && num(v.at),
  draft: (v: unknown): v is DraftEntry => isObj(v) && v.v === 1 && isStr(v.text),
  answer: (v: unknown): v is AnswerEntry =>
    isObj(v) && v.v === 1 && isStr(v.prompt) && (v.answer === null || isStr(v.answer)) && typeof v.done === "boolean" && num(v.at),
  set: (v: unknown): v is SetEntry => isObj(v) && v.v === 1 && strList(v.prompts) && num(v.at),
  settings: (v: unknown): v is SettingsEntry => isObj(v) && v.v === 1 && strList(v.active),
  morning: (v: unknown): v is LegacyMorningEntry =>
    isObj(v) && v.v === 1 && isStr(v.text) && Number.isInteger(v.pages) && (v.pages as number) >= 0 &&
    (v.draft === undefined || isStr(v.draft)) && strList(v.photos),
  checkin: (v: unknown): v is LegacyCheckinEntry =>
    isObj(v) && v.v === 1 && strList(v.prompts) && Array.isArray(v.answers) &&
    v.answers.length === (v.prompts as string[]).length && v.answers.every((a) => a === null || isStr(a)) &&
    Number.isInteger(v.step) && typeof v.finished === "boolean",
} as const;

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
