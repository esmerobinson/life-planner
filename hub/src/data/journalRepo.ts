// The journal's reads and writes (journal brief; review C1, C2, I3): part of the repo layer
// (re-exported from repo.ts), so every write goes through the change tracker like any other
// synced row.
//
// - Every part of a day is its own row (types.ts JOURNAL_KINDS): a finished page, a photo, an
//   answer, one device's draft. Rows are only ever written whole by the one action that owns
//   them, so two devices can never overwrite each other's part of a day.
// - Rows are sealed with the CONFIRMED journal key before they reach IndexedDB; the plaintext
//   exists only in memory. Every write checks, inside its transaction, that the key it seals
//   with is still this device's confirmed key (a stale or unconfirmed key never writes).
// - A row this key can't open (another fingerprint, tampered, unknown shape) is reported on its
//   own and skipped; it never blocks anything and is never written over.
// - Morning pages' text is only decrypted for Read back, MORNING_LOCK_DAYS after its date.
// - The earlier one-row-per-day shape ("morning" / "checkin" rows) is read and split into
//   parts on the fly; it is never written again.

import { db } from "./db";
import { addDays } from "../domain/dates";
import { journalId, MAX_JOURNAL_CT, validJournal } from "./validate";
import {
  exerciseCardIdKey, exerciseCardKey, fileAad, journalAad, openBytes, openJson, promptKey, sealBytes, sealJson,
  type JournalKey,
} from "../journal/crypto";
import {
  ENTRY_CHECK, MORNING_LOCK_DAYS, type AnswerEntry, type ExerciseEntryV2, type ExerciseResponseEntry, type PartAnswer,
} from "../journal/entries";
import { JOURNAL_KEY_META } from "../journal/keyStore";
import {
  legacyCardId, mergeStars, readStoredSet, storedCards, storedTracks, tableUpTo, type CardSet, type ExerciseCard, type ExerciseMark, type StarMark,
} from "../journal/exercise";
import type { FileRow, ISODate, JournalKind, JournalRow } from "../domain/types";

/** Shown for any row (or photo) that does not open on this device. */
export const CANT_OPEN = "Can't open this entry on this device";
/** Thrown when the key in hand is not (or no longer) this device's confirmed key. */
export const NOT_CONFIRMED = "The journal is locked on this device.";

type Shape<K extends keyof typeof ENTRY_CHECK> = (typeof ENTRY_CHECK)[K] extends (v: unknown) => v is infer T ? T : never;
export type Opened<T> = { state: "ok"; entry: T } | { state: "unreadable" };

/** Opens one row as `kind`. Another key's fingerprint is not even tried. */
async function openRow<K extends keyof typeof ENTRY_CHECK>(jk: JournalKey, row: JournalRow, kind: K): Promise<Opened<Shape<K>>> {
  if (row.fp !== undefined && row.fp !== jk.fp) return { state: "unreadable" };
  try {
    const value = await openJson(jk.key, row, journalAad(row.id));
    return ENTRY_CHECK[kind](value) ? { state: "ok", entry: value as Shape<K> } : { state: "unreadable" };
  } catch {
    return { state: "unreadable" };
  }
}

async function seal(jk: JournalKey, kind: JournalKind, date: ISODate, suffix: string | undefined, entry: unknown): Promise<JournalRow> {
  const id = journalId(kind, date, suffix);
  const row: JournalRow = { id, kind, date, fp: jk.fp, ...(await sealJson(jk.key, entry, journalAad(id))) };
  if (!validJournal(row)) throw new Error("That journal entry could not be saved.");
  return row;
}

/**
 * Writes rows (and files) in ONE transaction, only while `jk` is still this device's
 * confirmed key. `onlyIfAbsent` rows are skipped when a row with that id already exists.
 */
async function write(jk: JournalKey, rows: JournalRow[], opts: { files?: FileRow[]; onlyIfAbsent?: boolean } = {}): Promise<boolean> {
  return db.transaction("rw", [db.journal, db.files, db.syncMeta], async () => {
    const confirmed = (await db.syncMeta.get(JOURNAL_KEY_META))?.value as { fp?: string } | undefined;
    if (!confirmed || confirmed.fp !== jk.fp) throw new Error(NOT_CONFIRMED);
    if (opts.onlyIfAbsent) {
      for (const r of rows) if (await db.journal.get(r.id)) return false;
    }
    if (opts.files?.length) await db.files.bulkPut(opts.files);
    await db.journal.bulkPut(rows);
    return true;
  });
}

const rowsOn = (date: ISODate) => db.journal.where("date").equals(date).toArray();
const suffixOf = (row: JournalRow) => row.id.slice(`${row.kind}:${row.date}:`.length);

// ---- morning pages -----------------------------------------------------------------------

/** One day's morning pages as the page may see them: never a finished page's text. */
export interface MorningDay {
  date: ISODate;
  done: boolean;
  /** Finished pages that day (from any device). */
  pages: number;
  /** This device's draft for the day. */
  draft: string;
  /** Photo file ids for the day. */
  photos: string[];
  /** Rows for the day this device can't open (each skipped on its own). */
  unreadable: number;
}

/** One day's morning pages. Finished pages and photos count from their rows alone. */
export async function readMorningDay(jk: JournalKey, date: ISODate, deviceId: string): Promise<MorningDay> {
  const day: MorningDay = { date, done: false, pages: 0, draft: "", photos: [], unreadable: 0 };
  let ownDraft = false;
  let legacyDraft = "";
  for (const row of await rowsOn(date)) {
    if (row.kind === "page") day.pages++;
    else if (row.kind === "photo") day.photos.push(suffixOf(row));
    else if (row.kind === "draft" && suffixOf(row) === deviceId) {
      const o = await openRow(jk, row, "draft");
      if (o.state === "ok") {
        day.draft = o.entry.text;
        ownDraft = true;
      } else day.unreadable++;
    } else if (row.kind === "morning") {
      const o = await openRow(jk, row, "morning");
      if (o.state === "ok") {
        day.pages += o.entry.pages > 0 ? 1 : 0;
        day.photos.push(...o.entry.photos);
        legacyDraft = o.entry.draft ?? "";
      } else day.unreadable++;
    }
  }
  if (!ownDraft) day.draft = legacyDraft;
  day.done = day.pages > 0 || day.photos.length > 0;
  return day;
}

/**
 * The days with a morning page or photo (for the star calendar and the streak). Page and
 * photo rows count by their clear kind and date, readable here or not: a star means she did
 * it. Only rows of the earlier one-row-per-day shape are opened (to see if they were done).
 */
export async function listMorningDone(jk: JournalKey): Promise<Set<ISODate>> {
  const done = new Set<ISODate>();
  for (const row of await db.journal.where("kind").anyOf("page", "photo").toArray()) done.add(row.date);
  for (const row of await db.journal.where("kind").equals("morning").toArray()) {
    if (done.has(row.date)) continue;
    const o = await openRow(jk, row, "morning");
    if (o.state === "ok" && (o.entry.pages > 0 || o.entry.photos.length > 0)) done.add(row.date);
  }
  return done;
}

/** Autosaves this device's draft for the day (sealed). Only this device writes it. */
export async function saveMorningDraft(jk: JournalKey, date: ISODate, deviceId: string, text: string): Promise<void> {
  await write(jk, [await seal(jk, "draft", date, deviceId, { v: 1, text })]);
}

/**
 * "I'm done": the page becomes its own row (a new one each time, so a later page that day
 * never touches an earlier one) and this device's draft is emptied, in one transaction.
 */
export async function finishMorningPage(jk: JournalKey, date: ISODate, deviceId: string, text: string): Promise<string> {
  const pageId = crypto.randomUUID();
  const page = await seal(jk, "page", date, pageId, { v: 1, text, at: Date.now() });
  const draft = await seal(jk, "draft", date, deviceId, { v: 1, text: "" });
  await write(jk, [page, draft]);
  return page.id;
}

/**
 * "Add photo": the downscaled JPEG is sealed into an encrypted file row and the day gets a
 * photo row, in one transaction. Returns the file id.
 */
export async function addMorningPhoto(
  jk: JournalKey,
  date: ISODate,
  picture: { mime: string; data: string; width: number; height: number },
): Promise<string> {
  const fileId = crypto.randomUUID();
  const bytes = Uint8Array.from(atob(picture.data), (c) => c.charCodeAt(0));
  const sealed = await sealBytes(jk.key, bytes, fileAad(fileId));
  const file: FileRow = {
    id: fileId, mime: picture.mime, data: sealed.ct, width: picture.width, height: picture.height, createdAt: date,
    encrypted: true, iv: sealed.iv, fp: jk.fp,
  };
  const row = await seal(jk, "photo", date, fileId, { v: 1, fileId, at: Date.now() });
  await write(jk, [row], { files: [file] });
  return fileId;
}

/** A journal photo, opened: "missing" until it has synced here, "unreadable" if it won't open. */
export async function openJournalPhoto(
  jk: JournalKey,
  fileId: string,
): Promise<{ state: "ok"; blob: Blob } | { state: "missing" } | { state: "unreadable" }> {
  const f = await db.files.get(fileId);
  if (!f || f.status === "purged") return { state: "missing" };
  if (f.encrypted !== true || !f.iv || (f.fp !== undefined && f.fp !== jk.fp)) return { state: "unreadable" };
  try {
    const bytes = await openBytes(jk.key, { iv: f.iv, ct: f.data }, fileAad(f.id));
    return { state: "ok", blob: new Blob([bytes as BlobPart], { type: f.mime }) };
  } catch {
    return { state: "unreadable" };
  }
}

/** The day a morning page opens in Read back. */
export const morningOpensOn = (date: ISODate): ISODate => addDays(date, MORNING_LOCK_DAYS);

/** Every finished page (row ids, no content), newest day first. Nothing is decrypted. */
export async function listReadBack(): Promise<{ id: string; date: ISODate }[]> {
  const rows = await db.journal.where("kind").anyOf("page", "morning").toArray();
  return rows
    .sort((a, b) => b.date.localeCompare(a.date) || (a.updatedAt ?? 0) - (b.updatedAt ?? 0))
    .map((r) => ({ id: r.id, date: r.date }));
}

export type MorningText =
  | { state: "locked"; opensOn: ISODate }
  | { state: "ok"; text: string }
  | { state: "none" }
  | { state: "unreadable" };

/**
 * Read back: one finished page, only once MORNING_LOCK_DAYS have passed since its day
 * (`today` is injected). While locked the row is not even decrypted.
 */
export async function readMorningPage(jk: JournalKey, id: string, today: ISODate): Promise<MorningText> {
  const row = await db.journal.get(id);
  if (!row || (row.kind !== "page" && row.kind !== "morning")) return { state: "none" };
  const opensOn = morningOpensOn(row.date);
  if (today < opensOn) return { state: "locked", opensOn };
  if (row.kind === "page") {
    const o = await openRow(jk, row, "page");
    return o.state === "ok" ? { state: "ok", text: o.entry.text } : { state: "unreadable" };
  }
  const o = await openRow(jk, row, "morning");
  if (o.state === "unreadable") return { state: "unreadable" };
  return o.entry.pages > 0 ? { state: "ok", text: o.entry.text } : { state: "none" };
}

// ---- check-in ----------------------------------------------------------------------------

/**
 * One question's answer for the day, merged across devices (each device writes its own row):
 * the newest non-empty answer, moved past if any device moved past it.
 */
export interface CheckinAnswer {
  answer: string | null;
  done: boolean;
  at: number;
}

function mergeAnswer(prev: CheckinAnswer | undefined, next: CheckinAnswer): CheckinAnswer {
  if (!prev) return next;
  const pick = (a: CheckinAnswer, b: CheckinAnswer) => {
    if (a.answer === null) return b.answer === null ? (a.at >= b.at ? a : b) : b;
    if (b.answer === null) return a;
    return a.at >= b.at ? a : b;
  };
  const best = pick(prev, next);
  return { answer: best.answer, done: prev.done || next.done, at: Math.max(prev.at, next.at) };
}

export interface CheckinDay {
  date: ISODate;
  /** The day's questions: the set (if any), then any other answered prompts (nothing is lost). */
  prompts: string[];
  /** Whether a set row exists for the day (another device may have opened it first). */
  hasSet: boolean;
  answers: Map<string, CheckinAnswer>;
  /** Rows for the day this device can't open (each skipped on its own). */
  unreadable: number;
}

/** One day's check-in, from its set and answer rows (and the earlier shape, split). */
export async function readCheckinDay(jk: JournalKey, date: ISODate): Promise<CheckinDay> {
  let set: string[] | null = null;
  let legacy: Shape<"checkin"> | null = null;
  const answers = new Map<string, CheckinAnswer>();
  let unreadable = 0;
  for (const row of await rowsOn(date)) {
    if (row.kind === "set") {
      const o = await openRow(jk, row, "set");
      if (o.state === "ok") set = o.entry.prompts;
      else unreadable++;
    } else if (row.kind === "answer") {
      const o = await openRow(jk, row, "answer");
      if (o.state === "ok") {
        const e = o.entry;
        answers.set(e.prompt, mergeAnswer(answers.get(e.prompt), { answer: e.answer, done: e.done, at: e.at }));
      } else unreadable++;
    } else if (row.kind === "checkin") {
      const o = await openRow(jk, row, "checkin");
      if (o.state === "ok") legacy = o.entry;
      else unreadable++;
    }
  }
  if (legacy) {
    legacy.prompts.forEach((p, i) => {
      if (answers.has(p)) return;
      const reached = legacy!.finished || i < legacy!.step;
      if (reached || legacy!.answers[i] !== null) answers.set(p, { answer: legacy!.answers[i] ?? null, done: reached, at: 0 });
    });
  }
  const base = set ?? legacy?.prompts ?? [];
  const extra = [...answers.entries()]
    .filter(([p]) => !base.includes(p))
    .sort((a, b) => a[1].at - b[1].at)
    .map(([p]) => p);
  return { date, prompts: [...base, ...extra], hasSet: set !== null || legacy !== null, answers, unreadable };
}

/** The first question not yet moved past (Next / Skip), or -1 once every one is. */
export function currentStep(day: CheckinDay): number {
  return day.prompts.findIndex((p) => !day.answers.get(p)?.done);
}

/**
 * The first device to open the check-in for a day writes the day's questions; every other
 * device then uses them. Returns false when a set was already there (nothing written).
 */
export async function ensureCheckinSet(jk: JournalKey, date: ISODate, prompts: string[]): Promise<boolean> {
  const row = await seal(jk, "set", date, undefined, { v: 1, prompts, at: Date.now() });
  return write(jk, [row], { onlyIfAbsent: true });
}

/**
 * Saves this device's answer to one question: its own row
 * `answer:<date>:<promptKey>:<deviceId>`, so it can never replace another device's answer
 * (or another question's). The prompt id is only inside the sealed entry; the row id carries
 * an opaque HMAC of it.
 */
export async function saveAnswer(
  jk: JournalKey,
  date: ISODate,
  prompt: string,
  deviceId: string,
  answer: string | null,
  done: boolean,
): Promise<void> {
  const entry: AnswerEntry = { v: 1, prompt, answer: answer && answer.trim() ? answer : null, done, at: Date.now() };
  await write(jk, [await seal(jk, "answer", date, `${await promptKey(jk, prompt)}:${deviceId}`, entry)]);
}

/** Every day with a check-in, newest first. */
export async function listCheckinDays(jk: JournalKey): Promise<CheckinDay[]> {
  const rows = await db.journal.where("kind").anyOf("set", "answer", "checkin").toArray();
  const dates = [...new Set(rows.map((r) => r.date))].sort((a, b) => b.localeCompare(a));
  return Promise.all(dates.map((d) => readCheckinDay(jk, d)));
}

// ---- Choose questions (synced) -------------------------------------------------------------

/** The chosen questions, or null when never chosen (or not readable here). */
export async function readPromptSettings(jk: JournalKey): Promise<string[] | null> {
  const row = await db.journal.get("settings");
  if (!row) return null;
  const o = await openRow(jk, row, "settings");
  return o.state === "ok" ? o.entry.active : null;
}

export async function savePromptSettings(jk: JournalKey, active: string[], today: ISODate): Promise<void> {
  await write(jk, [await seal(jk, "settings", today, undefined, { v: 1, active: [...new Set(active)] })]);
}

// ---- mental health exercise (exercise brief) ------------------------------------------------

/** Shown when a card file is too big to store as one synced row. */
export const CARDS_TOO_BIG = "That card file is too big to store. Nothing was changed.";

export type CardsState = { state: "none" } | { state: "ok"; set: CardSet } | { state: "unreadable" };

/** The imported exercise cards (the one sealed `cards` row), if any. */
export async function readExerciseCards(jk: JournalKey): Promise<CardsState> {
  const row = await db.journal.get("cards");
  if (!row) return { state: "none" };
  const o = await openRow(jk, row, "cards");
  if (o.state !== "ok") return { state: "unreadable" };
  const set = readStoredSet(o.entry.v, o.entry.source, o.entry.cards, o.entry.tracks);
  return set ? { state: "ok", set } : { state: "unreadable" };
}

/**
 * Import: the whole set as one sealed row `cards` (synced like any journal row), in its file
 * version's shape. A new import replaces it whole. Refused (nothing stored) if it would not
 * fit in one synced row.
 */
export async function importExerciseCards(jk: JournalKey, set: CardSet, today: ISODate): Promise<void> {
  const id = journalId("cards", today);
  const tracks = storedTracks(set);
  const entry = { v: set.version, source: set.source, ...(tracks ? { tracks } : {}), cards: storedCards(set), at: Date.now() };
  const sealed = await sealJson(jk.key, entry, journalAad(id));
  if (sealed.ct.length > MAX_JOURNAL_CT) throw new Error(CARDS_TOO_BIG);
  const row: JournalRow = { id, kind: "cards", date: today, fp: jk.fp, ...sealed };
  if (!validJournal(row)) throw new Error("That journal entry could not be saved.");
  await write(jk, [row]);
}

export interface ExerciseProgress {
  /** Every device's cards for each day, and whether each was done. */
  marks: ExerciseMark[];
  /** Starred cards by id (per card, the newest mark from any device). */
  starred: Set<string>;
  /** Rows this device can't open (each skipped on its own). */
  unreadable: number;
}

/** All exercise progress and stars, from every device's rows (version 1 rows, by day, read as "day-N"). */
export async function readExerciseProgress(jk: JournalKey): Promise<ExerciseProgress> {
  const marks: ExerciseMark[] = [];
  const stars: StarMark[][] = [];
  let unreadable = 0;
  for (const row of await db.journal.where("kind").anyOf("exercise", "stars").toArray()) {
    if (row.kind === "exercise") {
      const o = await openRow(jk, row, "exercise");
      if (o.state !== "ok") {
        unreadable++;
        continue;
      }
      const e = o.entry;
      const device = suffixOf(row);
      marks.push({ date: row.date, device, id: e.v === 1 ? legacyCardId(e.day) : e.id, done: e.done, primary: true });
      if (e.v === 2) for (const id of e.also) marks.push({ date: row.date, device, id, done: true, primary: false });
      if (e.v === 2) for (const id of e.logged ?? []) marks.push({ date: row.date, device, id, done: false, primary: false, logged: true });
    } else {
      const o = await openRow(jk, row, "stars");
      if (o.state !== "ok") unreadable++;
      else if (o.entry.v === 1) stars.push(o.entry.marks.map((m) => ({ id: legacyCardId(m.day), on: m.on, at: m.at })));
      else stars.push(o.entry.marks);
    }
  }
  return { marks, starred: mergeStars(stars), unreadable };
}

/** This device's own progress row for the day, opened (never written over if it won't open). */
async function ownMarks(jk: JournalKey, date: ISODate, deviceId: string): Promise<ExerciseEntryV2 | null> {
  const existing = await db.journal.get(journalId("exercise", date, deviceId));
  if (!existing) return null;
  const o = await openRow(jk, existing, "exercise");
  if (o.state !== "ok") throw new Error(CANT_OPEN);
  const e = o.entry;
  return e.v === 2 ? e : { v: 2, id: legacyCardId(e.day), done: e.done, also: [], at: e.at };
}

/**
 * This device's row for the day with one card marked: today's card (`todayId`) is the row's
 * own card; any other card done that day goes in `also`.
 */
function marked(prev: ExerciseEntryV2 | null, todayId: string, cardId: string, done: boolean, log = false): ExerciseEntryV2 {
  let id = prev?.id ?? todayId;
  let ownDone = prev?.done ?? false;
  let also = (prev?.also ?? []).filter((x) => x !== cardId);
  const logged = (prev?.logged ?? []).filter((x) => x !== cardId);
  if (log) return { v: 2, id, done: ownDone, also, logged: [...logged, cardId], at: Date.now() };
  if (cardId === todayId) {
    if (id !== todayId && ownDone) also = [...also.filter((x) => x !== id), id]; // the earlier card stays done
    id = todayId;
    ownDone = done;
  } else if (done) {
    also = [...also, cardId];
  }
  return { v: 2, id, done: ownDone, also, ...(logged.length ? { logged } : {}), at: Date.now() };
}

/** Marks today's card done or not on this device's own row for the day (further cards stay). */
export async function saveExerciseMark(jk: JournalKey, date: ISODate, deviceId: string, cardId: string, done: boolean): Promise<void> {
  const next = marked(await ownMarks(jk, date, deviceId), cardId, cardId, done);
  await write(jk, [await seal(jk, "exercise", date, deviceId, next)]);
}

/**
 * Records the card shown today on this device (not done), so it stays today's card all day.
 * Returns false (nothing written) if this device already has a row for the day.
 */
export async function recordExerciseShown(jk: JournalKey, date: ISODate, deviceId: string, cardId: string): Promise<boolean> {
  const entry: ExerciseEntryV2 = { v: 2, id: cardId, done: false, also: [], at: Date.now() };
  return write(jk, [await seal(jk, "exercise", date, deviceId, entry)], { onlyIfAbsent: true });
}

// ---- exercise responses (journal polish brief) ---------------------------------------------

/**
 * The card a response belongs to. A version 1 card's responses are keyed (and stored) by its
 * day and theme, as before; a version 2 card's by its id.
 */
export interface ExerciseCardRef {
  id: string;
  day: number | null;
  theme: string;
  legacy: boolean;
}

export const cardRef = (c: ExerciseCard): ExerciseCardRef => ({ id: c.id, day: c.day, theme: c.theme, legacy: c.legacy });

/** A day's response to one card, merged across devices. */
export interface ExerciseResponse {
  date: ISODate;
  /** The card's id ("day-N" for a version 1 card). */
  id: string;
  day: number | null;
  theme: string;
  /** The newest non-empty response from any device (else the newest). */
  text: string;
  /** A card with parts: each part's answer (with its prompt); null for a single response. */
  parts: PartAnswer[] | null;
  at: number;
  /** The text shown is exactly what was last submitted (nothing typed since). */
  saved: boolean;
  /** Submitted on some device at least once (a draft only, if not). */
  submitted: boolean;
}

const ENTRY_PREFIX = "exercise-entry:";

const cardKey = (jk: JournalKey, card: ExerciseCardRef) =>
  card.legacy ? exerciseCardKey(jk, card.day!, card.theme) : exerciseCardIdKey(jk, card.id);

async function entryRowId(jk: JournalKey, date: ISODate, card: ExerciseCardRef, deviceId: string): Promise<string> {
  return journalId("exercise-entry", date, `${await cardKey(jk, card)}:${deviceId}`);
}

export type { PartAnswer };

/** What she wrote for a card: one text, or (a card with parts) each part's answer. */
export type ResponseValue = string | PartAnswer[];

const line = (x: unknown) => typeof x === "string" && x.trim() !== "";
const fullRow = (r: unknown) => Array.isArray(r) && r.length > 0 && r.every(line);
const emptyRow = (r: unknown) => Array.isArray(r) && !r.some(line);

/** One part's answer is there in full (a list or chain: every line; a table: every row, or the first for "up to"; a tracker: every day). */
export function answerFilled(a: PartAnswer): boolean {
  const v = a.answer;
  switch (a.kind) {
    case "text":
      return line(v);
    case "list":
    case "chain":
      return Array.isArray(v) && v.length > 0 && (v as unknown[]).every(line);
    case "table":
      if (!Array.isArray(v) || v.length === 0) return false;
      return tableUpTo(a.prompt) ? fullRow(v[0]) && (v as unknown[]).every((r) => fullRow(r) || emptyRow(r)) : (v as unknown[]).every(fullRow);
    case "tracker":
      return Array.isArray(v) && v.length > 0 && (v as unknown[]).every(fullRow);
    case "rating":
    case "scale":
      return typeof v === "number";
    default:
      return typeof v === "string" && v !== "";
  }
}

/** Anything at all written or chosen (a draft worth keeping and showing). */
const started = (v: unknown): boolean => (Array.isArray(v) ? v.some(started) : typeof v === "string" ? v.trim() !== "" : v !== null);
const partStarted = (a: PartAnswer) => started(a.answer);

/**
 * A card with a tracker, not finished: every other part filled and at least one tracker day
 * filled in. It can be saved for the day ("logged") without the card being done.
 */
export const responseLoggable = (value: ResponseValue): boolean =>
  typeof value !== "string" &&
  value.some((a) => a.kind === "tracker") &&
  value.every((a) => (a.kind === "tracker" ? Array.isArray(a.answer) && (a.answer as unknown[]).some(fullRow) : answerFilled(a)));
const hasContent = (e: { text: string; parts?: PartAnswer[] | null }) => e.text.trim() !== "" || (e.parts ?? []).some(partStarted);

/** Complete enough to submit: some text, or every part filled in. */
export const responseComplete = (value: ResponseValue): boolean =>
  typeof value === "string" ? value.trim() !== "" : value.length > 0 && value.every(answerFilled);

/** The entry sealed for a card's response: a version 1 card keeps the earlier shape. */
function responseEntry(card: ExerciseCardRef, value: ResponseValue, submittedAt: number | null, at: number): ExerciseResponseEntry {
  const text = typeof value === "string" ? value : "";
  if (card.legacy) return { v: 1, day: card.day!, theme: card.theme, text, submittedAt, at };
  return {
    v: 2, id: card.id, day: card.day, theme: card.theme, text, ...(typeof value === "string" ? {} : { parts: value }), submittedAt, at,
  };
}

/** The newest non-empty of one card's rows (each device writes its own), as the check-in merges answers. */
function mergeResponses(date: ISODate, rows: ExerciseResponseEntry[]): ExerciseResponse | null {
  if (rows.length === 0) return null;
  const newest = (list: ExerciseResponseEntry[]) => list.reduce((a, b) => (b.at > a.at ? b : a));
  const filled = rows.filter((r) => hasContent({ text: r.text, parts: r.v === 2 ? r.parts : null }));
  const best = newest(filled.length ? filled : rows);
  return {
    date, id: best.v === 2 ? best.id : legacyCardId(best.day), day: best.day, theme: best.theme, text: best.text,
    parts: best.v === 2 ? (best.parts ?? null) : null, at: best.at,
    saved: best.submittedAt !== null && best.submittedAt === best.at,
    submitted: rows.some((r) => r.submittedAt !== null),
  };
}

/** One row group per day and card (the row id without its device), opened. */
async function openResponses(jk: JournalKey, rows: JournalRow[]) {
  const groups = new Map<string, { date: ISODate; entries: ExerciseResponseEntry[] }>();
  let unreadable = 0;
  for (const row of rows) {
    if (row.kind !== "exercise-entry") continue;
    const o = await openRow(jk, row, "exercise-entry");
    if (o.state !== "ok") {
      unreadable++;
      continue;
    }
    const group = row.id.slice(0, row.id.lastIndexOf(":"));
    const g = groups.get(group) ?? { date: row.date, entries: [] };
    g.entries.push(o.entry);
    groups.set(group, g);
  }
  return { groups: [...groups.values()], unreadable };
}

/** A day's response to one card, from every device's row. */
export async function readExerciseEntry(
  jk: JournalKey,
  date: ISODate,
  card: ExerciseCardRef,
): Promise<{ entry: ExerciseResponse | null; unreadable: number }> {
  const prefix = `${ENTRY_PREFIX}${date}:${await cardKey(jk, card)}:`;
  const { groups, unreadable } = await openResponses(jk, (await rowsOn(date)).filter((r) => r.id.startsWith(prefix)));
  return { entry: groups[0] ? mergeResponses(date, groups[0].entries) : null, unreadable };
}

/** This device's own response row for the card, opened (never written over if it won't open). */
async function ownResponse(jk: JournalKey, id: string): Promise<ExerciseResponseEntry | null> {
  const existing = await db.journal.get(id);
  if (!existing) return null;
  const o = await openRow(jk, existing, "exercise-entry");
  if (o.state !== "ok") throw new Error(CANT_OPEN);
  return o.entry;
}

/**
 * Autosaves this device's response as typed (a draft: never marks the card Done). After a
 * Submit it keeps the submit time, so the response stays submitted but no longer "Saved".
 */
export async function saveExerciseDraft(
  jk: JournalKey,
  date: ISODate,
  deviceId: string,
  card: ExerciseCardRef,
  value: ResponseValue,
): Promise<void> {
  const id = await entryRowId(jk, date, card, deviceId);
  const prev = await ownResponse(jk, id);
  const entry = responseEntry(card, value, prev?.submittedAt ?? null, Date.now());
  await write(jk, [await seal(jk, "exercise-entry", date, id.slice(`${ENTRY_PREFIX}${date}:`.length), entry)]);
}

/**
 * Submit: this device's response row (written whole, again on each Submit) and the card's
 * done mark on this device's progress row, in one transaction. `todayId` is today's card;
 * submitting another card ("Do the next one") marks that one done too, on the same day.
 */
export async function submitExerciseEntry(
  jk: JournalKey,
  date: ISODate,
  deviceId: string,
  card: ExerciseCardRef,
  value: ResponseValue,
  todayId: string = card.id,
): Promise<void> {
  if (!responseComplete(value)) throw new Error("There is nothing to submit yet.");
  const id = await entryRowId(jk, date, card, deviceId);
  await ownResponse(jk, id);
  const marks = marked(await ownMarks(jk, date, deviceId), todayId, card.id, true);
  const at = Date.now();
  const response = await seal(jk, "exercise-entry", date, id.slice(`${ENTRY_PREFIX}${date}:`.length), responseEntry(card, value, at, at));
  const mark = await seal(jk, "exercise", date, deviceId, { ...marks, at });
  await write(jk, [response, mark]);
}

/**
 * A tracker card's day saved (Journal v2): this device's response row (submitted, so it shows
 * "Saved") and, on its progress row, the card logged for the day (not done: it comes back
 * tomorrow until every day is filled). The day counts on the Home row.
 */
export async function logExerciseEntry(
  jk: JournalKey,
  date: ISODate,
  deviceId: string,
  card: ExerciseCardRef,
  value: ResponseValue,
  todayId: string = card.id,
): Promise<void> {
  if (!responseLoggable(value)) throw new Error("There is nothing to save yet.");
  const id = await entryRowId(jk, date, card, deviceId);
  await ownResponse(jk, id);
  const marks = marked(await ownMarks(jk, date, deviceId), todayId, card.id, false, true);
  const at = Date.now();
  const response = await seal(jk, "exercise-entry", date, id.slice(`${ENTRY_PREFIX}${date}:`.length), responseEntry(card, value, at, at));
  const mark = await seal(jk, "exercise", date, deviceId, { ...marks, at });
  await write(jk, [response, mark]);
}

/**
 * The newest response to a card on any day up to `date` (a tracker card carries its earlier
 * days forward), or null.
 */
export async function readLatestExerciseEntry(jk: JournalKey, date: ISODate, card: ExerciseCardRef): Promise<ExerciseResponse | null> {
  const key = `:${await cardKey(jk, card)}:`;
  const rows = (await db.journal.where("kind").equals("exercise-entry").toArray()).filter((r) => r.date <= date && r.id.includes(key));
  const { groups } = await openResponses(jk, rows);
  const all = groups.map((g) => mergeResponses(g.date, g.entries)!).sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
  return all[0] ?? null;
}

/**
 * Every response before `before` (one per day and card, merged across devices), newest
 * first. Empty drafts are left out; responses are readable any time.
 */
export async function listExerciseEntries(jk: JournalKey, before: ISODate): Promise<{ entries: ExerciseResponse[]; unreadable: number }> {
  const rows = (await db.journal.where("kind").equals("exercise-entry").toArray()).filter((r) => r.date < before);
  const { groups, unreadable } = await openResponses(jk, rows);
  const entries = groups
    .map((g) => mergeResponses(g.date, g.entries)!)
    .filter(hasContent)
    .sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
  return { entries, unreadable };
}

/** Stars or un-stars a card (by id) in this device's own stars row (only this device writes it). */
export async function setExerciseStar(jk: JournalKey, today: ISODate, deviceId: string, cardId: string, on: boolean): Promise<void> {
  const id = journalId("stars", today, deviceId);
  const existing = await db.journal.get(id);
  let marks: StarMark[] = [];
  if (existing) {
    const o = await openRow(jk, existing, "stars");
    if (o.state !== "ok") throw new Error(CANT_OPEN); // never written over
    marks = o.entry.v === 1 ? o.entry.marks.map((m) => ({ id: legacyCardId(m.day), on: m.on, at: m.at })) : o.entry.marks;
  }
  marks = [...marks.filter((m) => m.id !== cardId), { id: cardId, on, at: Date.now() }];
  await write(jk, [await seal(jk, "stars", today, deviceId, { v: 2, marks })]);
}
