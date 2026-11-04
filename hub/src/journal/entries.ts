// What is inside a journal row once it is opened (only ever in memory). Each kind's shape
// is checked after decrypting: a row that opens but is not a shape this version knows counts
// as "can't open" and is skipped on its own.

import { isObj, isStr } from "../data/validate";
import { MAX_CARD_DAY, MAX_CARD_ID, MAX_PARTS, PART_KINDS, readStoredSet, type PartKind, type PartValue } from "./exercise";

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
  /**
   * She cleared this answer on purpose with Edit (bug #30): unlike a skipped or empty one, it
   * can win over an older answer from another device. Never set by Skip.
   */
  cleared?: true;
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

/**
 * The imported exercise cards, the whole set (exercise brief): `v` is the card file's version
 * and `cards` its cards in that version's file shape (exercise.ts storedCards).
 */
export interface CardsEntry {
  v: 1 | 2;
  source: string;
  /** The file's books (tracks), when it lists them. */
  tracks?: unknown;
  cards: Record<string, unknown>[];
  at: number;
}

/**
 * The card set in chunks (Journal v2: a set of two books is too big for one synced row): the
 * `cards` row is the manifest, written last, naming the import (`setId`) and how many chunks
 * `cards:0` … `cards:<chunks-1>` hold its cards, in order.
 */
export interface CardsManifest {
  v: 3;
  setId: string;
  chunks: number;
  version: 1 | 2;
  source: string;
  tracks?: unknown;
  importedAt: number;
  at: number;
}

/** One chunk of the cards (in their file version's shape), for the import `setId`. */
export interface CardsChunk {
  v: 4;
  setId: string;
  k: number;
  cards: Record<string, unknown>[];
}

export type CardsRow = CardsEntry | CardsManifest | CardsChunk;

/** One device's exercise card for a day, and whether it was done (version 1: by day). */
export interface ExerciseEntryV1 {
  v: 1;
  day: number;
  done: boolean;
  at: number;
}

/**
 * One device's exercise marks for a day (Journal v2, by card id): its card for the day
 * (`id`, shown then perhaps `done`) and any further cards done that day (`also`).
 */
export interface ExerciseEntryV2 {
  v: 2;
  id: string;
  done: boolean;
  also: string[];
  /** Tracker cards with a day filled in that day, not finished yet (they count for the day). */
  logged?: string[];
  at: number;
}

export type ExerciseEntry = ExerciseEntryV1 | ExerciseEntryV2;

/** One device's star marks (per card, the newest mark from any device wins). v1: by day. */
export type StarsEntry = { v: 1; marks: { day: number; on: boolean; at: number }[] } | { v: 2; marks: { id: string; on: boolean; at: number }[] };

/**
 * One device's written response to a day's exercise card (journal polish brief). The card's
 * day and theme are kept so it reads back even after the card set is replaced. `submittedAt`
 * is null until Submit; `at` is the last save (an autosave after Submit leaves `submittedAt`).
 * Version 1 is a version 1 card's (by day and theme); version 2 also keeps the card's id.
 */
export type ExerciseResponseEntry = (
  | { v: 1; day: number; theme: string; text: string; submittedAt: number | null; at: number }
  | {
      v: 2;
      id: string;
      day: number | null;
      theme: string;
      text: string;
      /** A card with parts: each part's answer, with its prompt and kind (so it reads back on its own). */
      parts?: PartAnswer[];
      submittedAt: number | null;
      at: number;
    }
) & {
  /** Saved by "Edit" on a submitted answer (its own row; the one it changed stays, review I4). */
  edit?: true;
};

/** One part's answer as stored. */
export interface PartAnswer {
  prompt: string;
  kind: PartKind;
  answer: PartValue;
}

/**
 * One note to herself (journal v3, "Notes to myself"): the thought that comes up in a hard
 * moment and her own steady answer, perhaps a memory or evidence and a skill to try. `prompt`
 * is the starter prompt it answers (null: her own thought). Deleted: every field emptied (the
 * row stays, as sync never hard-deletes).
 */
export interface NoteEntry {
  v: 1;
  prompt: string | null;
  thought: string;
  steady: string;
  memory: string;
  skill: string;
  createdAt: number;
  at: number;
  deleted?: true;
  /** This version's own random id (absent on the earliest notes: its row id and time stand in). */
  vid?: string;
  /** The versions she had in front of her when she wrote this one (by vid): it is written over them. */
  seen?: string[];
  /** This device's note in progress, not saved yet (its own row). */
  draft?: true;
}

/** One device's "I read this today" ticks for a day: the notes' row ids. */
export interface NoteReadEntry {
  v: 1;
  ids: string[];
  at: number;
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
const cardDay = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_CARD_DAY;
const cardId = (v: unknown): v is string => isStr(v) && v !== "" && v.length <= MAX_CARD_ID;
const partValue = (v: unknown): v is PartValue =>
  v === null || isStr(v) || (Array.isArray(v) && (v.every(isStr) || v.every((r) => Array.isArray(r) && r.every(isStr)))) ||
  (Number.isInteger(v) && Math.abs(v as number) <= 1000);
const partAnswers = (v: unknown): v is PartAnswer[] =>
  Array.isArray(v) && v.length <= MAX_PARTS &&
  v.every((p) => isObj(p) && isStr(p.prompt) && PART_KINDS.includes(p.kind as PartKind) && partValue(p.answer));

export const ENTRY_CHECK = {
  page: (v: unknown): v is PageEntry => isObj(v) && v.v === 1 && isStr(v.text) && num(v.at),
  photo: (v: unknown): v is PhotoEntry => isObj(v) && v.v === 1 && isStr(v.fileId) && num(v.at),
  draft: (v: unknown): v is DraftEntry => isObj(v) && v.v === 1 && isStr(v.text),
  answer: (v: unknown): v is AnswerEntry =>
    isObj(v) && v.v === 1 && isStr(v.prompt) && (v.answer === null || isStr(v.answer)) && typeof v.done === "boolean" && num(v.at) &&
    (v.cleared === undefined || (v.cleared === true && v.answer === null)),
  set: (v: unknown): v is SetEntry => isObj(v) && v.v === 1 && strList(v.prompts) && num(v.at),
  settings: (v: unknown): v is SettingsEntry => isObj(v) && v.v === 1 && strList(v.active),
  cards: (v: unknown): v is CardsRow =>
    isObj(v) &&
    (v.v === 3
      ? isStr(v.setId) && v.setId !== "" && Number.isInteger(v.chunks) && (v.chunks as number) >= 1 && (v.chunks as number) <= 1000 &&
        (v.version === 1 || v.version === 2) && isStr(v.source) && num(v.importedAt) && num(v.at)
      : v.v === 4
        ? isStr(v.setId) && Number.isInteger(v.k) && (v.k as number) >= 0 && Array.isArray(v.cards) && v.cards.every(isObj)
        : (v.v === 1 || v.v === 2) && num(v.at) && readStoredSet(v.v, v.source, v.cards, v.tracks) !== null),
  exercise: (v: unknown): v is ExerciseEntry =>
    isObj(v) && typeof v.done === "boolean" && num(v.at) &&
    (v.v === 1
      ? cardDay(v.day)
      : v.v === 2 && cardId(v.id) && Array.isArray(v.also) && v.also.every(cardId) &&
        (v.logged === undefined || (Array.isArray(v.logged) && v.logged.every(cardId)))),
  stars: (v: unknown): v is StarsEntry =>
    isObj(v) && (v.v === 1 || v.v === 2) && Array.isArray(v.marks) &&
    v.marks.every((m) => isObj(m) && (v.v === 1 ? cardDay(m.day) : cardId(m.id)) && typeof m.on === "boolean" && num(m.at)),
  "exercise-entry": (v: unknown): v is ExerciseResponseEntry =>
    isObj(v) && (v.edit === undefined || v.edit === true) && isStr(v.theme) && isStr(v.text) && (v.submittedAt === null || num(v.submittedAt)) && num(v.at) &&
    (v.v === 1
      ? cardDay(v.day)
      : v.v === 2 && cardId(v.id) && (v.day === null || cardDay(v.day)) && (v.parts === undefined || partAnswers(v.parts))),
  note: (v: unknown): v is NoteEntry =>
    isObj(v) && v.v === 1 && (v.prompt === null || isStr(v.prompt)) && isStr(v.thought) && isStr(v.steady) &&
    isStr(v.memory) && isStr(v.skill) && num(v.createdAt) && num(v.at) && (v.deleted === undefined || v.deleted === true) &&
    (v.vid === undefined || (isStr(v.vid) && v.vid.length <= 64)) && (v.seen === undefined || (strList(v.seen) && (v.seen as string[]).length <= 64)) &&
    (v.draft === undefined || v.draft === true),
  "note-read": (v: unknown): v is NoteReadEntry => isObj(v) && v.v === 1 && strList(v.ids) && num(v.at),
  morning: (v: unknown): v is LegacyMorningEntry =>
    isObj(v) && v.v === 1 && isStr(v.text) && Number.isInteger(v.pages) && (v.pages as number) >= 0 &&
    (v.draft === undefined || isStr(v.draft)) && strList(v.photos),
  checkin: (v: unknown): v is LegacyCheckinEntry =>
    isObj(v) && v.v === 1 && strList(v.prompts) && Array.isArray(v.answers) &&
    v.answers.length === (v.prompts as string[]).length && v.answers.every((a) => a === null || isStr(a)) &&
    Number.isInteger(v.step) && typeof v.finished === "boolean",
} as const;

/** Words in a text (for "N of 1,000 words"). */
export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * A finished typed page is hidden this many days from its date (Esme, journal round: "hidden
 * for 4 weeks, then readable"), then opens read-only in "Read back".
 */
export const MORNING_LOCK_DAYS = 28;

/** Her minimum (Journal v2: "1,000 words", about three pages), shown as "N of 1,000 words". A target, not a lock. */
export const MORNING_WORDS = 1000;
