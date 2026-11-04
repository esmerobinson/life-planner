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
  legacyCardId, MAX_PARTS, mergeStars, readStoredSet, storedCards, storedTracks, tableUpTo, type CardSet, type ExerciseCard, type ExerciseMark, type StarMark,
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

/**
 * The days with a finished morning page, a morning photo or a check-in answer, from the rows'
 * clear kind and date alone: nothing is opened, so it needs no key (goals redesign: "Journal
 * daily" counts these). Read only.
 */
export async function listJournalledDays(): Promise<Set<ISODate>> {
  const rows = await db.journal.where("kind").anyOf("page", "photo", "answer").toArray();
  return new Set(rows.map((r) => r.date));
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

/**
 * Next / Skip on a box with nothing new typed: marks this device's row moved past and keeps
 * whatever answer that row already holds (typed here earlier). Never copies another
 * device's answer, and never blanks this device's own one.
 */
export async function moveAnswerOn(jk: JournalKey, date: ISODate, prompt: string, deviceId: string): Promise<void> {
  const own = await db.journal.get(journalId("answer", date, `${await promptKey(jk, prompt)}:${deviceId}`));
  let answer: string | null = null;
  if (own) {
    const o = await openRow(jk, own, "answer");
    if (o.state !== "ok") throw new Error("That answer could not be read, so it was left as it is.");
    answer = o.entry.answer;
  }
  await saveAnswer(jk, date, prompt, deviceId, answer, true);
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

/** Shown when a card file is too big to store at all. */
export const CARDS_TOO_BIG = "That card file is too big to store. Nothing was changed.";
/** The most card text (JSON) one chunk row holds before sealing (split on card boundaries). */
export const CARDS_CHUNK_BYTES = 250_000;
/** The most card text (JSON) a whole set may have. */
export const MAX_CARDS_BYTES = 8_000_000;

/** "syncing": the set's manifest is here but not all its chunks yet. */
export type CardsState = { state: "none" } | { state: "ok"; set: CardSet } | { state: "unreadable" } | { state: "syncing" };

/**
 * The imported exercise cards, if any: the chunks the `cards` manifest names, joined (or the
 * earlier single-row set). A chunk that hasn't arrived yet, or is from another import, means
 * the set is still syncing; a chunk this key can't open makes it unreadable.
 */
export async function readExerciseCards(jk: JournalKey): Promise<CardsState> {
  const row = await db.journal.get("cards");
  if (!row) return { state: "none" };
  const o = await openRow(jk, row, "cards");
  if (o.state !== "ok") return { state: "unreadable" };
  const e = o.entry;
  if (e.v === 4) return { state: "unreadable" };
  if (e.v === 1 || e.v === 2) {
    const set = readStoredSet(e.v, e.source, e.cards, e.tracks);
    return set ? { state: "ok", set } : { state: "unreadable" };
  }
  if (e.v !== 3) return { state: "unreadable" };
  const chunks = await Promise.all(Array.from({ length: e.chunks }, (_, k) => db.journal.get(journalId("cards", row.date, String(k)))));
  // The same manifest and chunks as last time: the set already opened (review M7: not every
  // database change decrypts and checks the whole set again).
  const key = [jk.fp, row.iv, ...chunks.map((c) => c?.iv ?? "-")].join("|");
  if (opened?.key === key) return opened.state;
  const cards: Record<string, unknown>[] = [];
  for (const [k, chunk] of chunks.entries()) {
    if (!chunk) return { state: "syncing" };
    const c = await openRow(jk, chunk, "cards");
    if (c.state !== "ok") return { state: "unreadable" };
    if (c.entry.v !== 4 || c.entry.k !== k) return { state: "unreadable" };
    if (c.entry.setId !== e.setId) return { state: "syncing" }; // an earlier import's chunk: the new one is on its way
    cards.push(...c.entry.cards);
  }
  const set = readStoredSet(e.version, e.source, cards, e.tracks);
  const state: CardsState = set ? { state: "ok", set } : { state: "unreadable" };
  if (set) opened = { key, state };
  return state;
}

/** The last card set opened from chunks, by its rows (one at a time; it holds no plaintext beyond memory). */
let opened: { key: string; state: CardsState } | null = null;

/** The stored cards in chunks of at most CARDS_CHUNK_BYTES of JSON, on card boundaries. */
function chunked(cards: Record<string, unknown>[]): Record<string, unknown>[][] {
  const enc = new TextEncoder();
  const out: Record<string, unknown>[][] = [[]];
  let size = 0;
  for (const c of cards) {
    const n = enc.encode(JSON.stringify(c)).length + 1;
    if (size + n > CARDS_CHUNK_BYTES && out[out.length - 1]!.length > 0) {
      out.push([]);
      size = 0;
    }
    out[out.length - 1]!.push(c);
    size += n;
  }
  return out;
}

/**
 * Import: the cards sealed in chunks `cards:0` … `cards:<n-1>` (each its own synced row, at most
 * CARDS_CHUNK_BYTES of card text), then the manifest `cards` naming this import and n, all in
 * one transaction (the manifest last). A new import writes a new set of chunks and manifest; an
 * earlier import's higher-numbered chunks are left as they are and never read (readers read only
 * the n the manifest names). Refused (nothing stored) if the set is too big to store at all.
 */
export async function importExerciseCards(jk: JournalKey, set: CardSet, today: ISODate): Promise<void> {
  const stored = storedCards(set);
  if (new TextEncoder().encode(JSON.stringify(stored)).length > MAX_CARDS_BYTES) throw new Error(CARDS_TOO_BIG);
  const setId = crypto.randomUUID();
  const parts = chunked(stored);
  const rows: JournalRow[] = [];
  for (const [k, cards] of parts.entries()) {
    const id = journalId("cards", today, String(k));
    const sealed = await sealJson(jk.key, { v: 4, setId, k, cards }, journalAad(id));
    if (sealed.ct.length > MAX_JOURNAL_CT) throw new Error(CARDS_TOO_BIG);
    rows.push({ id, kind: "cards", date: today, fp: jk.fp, ...sealed });
  }
  // An earlier import's higher chunks are emptied, so they don't linger (review M3).
  for (const old of await db.journal.where("kind").equals("cards").toArray()) {
    const k = old.id.startsWith("cards:") ? Number(old.id.slice("cards:".length)) : -1;
    if (k < parts.length) continue;
    const id = journalId("cards", today, String(k));
    rows.push({ id, kind: "cards", date: today, fp: jk.fp, ...(await sealJson(jk.key, { v: 4, setId, k, cards: [] }, journalAad(id))) });
  }
  const tracks = storedTracks(set);
  const manifest = {
    v: 3, setId, chunks: parts.length, version: set.version, source: set.source, ...(tracks ? { tracks } : {}),
    importedAt: Date.now(), at: Date.now(),
  };
  const id = journalId("cards", today);
  rows.push({ id, kind: "cards", date: today, fp: jk.fp, ...(await sealJson(jk.key, manifest, journalAad(id))) });
  if (!rows.every(validJournal)) throw new Error("That journal entry could not be saved.");
  await write(jk, rows);
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

/**
 * This device's marks row is read, changed and written outside one transaction (sealing can't
 * run inside it), so its changes go one at a time (review M5: two quick submits never lose a mark).
 */
let marksQueue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(op: () => Promise<T>): Promise<T> {
  const next = marksQueue.then(op, op);
  marksQueue = next.catch(() => undefined);
  return next;
}

/** Marks today's card done or not on this device's own row for the day (further cards stay). */
export function saveExerciseMark(jk: JournalKey, date: ISODate, deviceId: string, cardId: string, done: boolean): Promise<void> {
  return oneAtATime(async () => {
    const next = marked(await ownMarks(jk, date, deviceId), cardId, cardId, done);
    await write(jk, [await seal(jk, "exercise", date, deviceId, next)]);
  });
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
  /**
   * Every other version of it with something written (another device's, an unsent draft, the
   * card's earlier key), newest first, so nothing she wrote is ever hidden. A version with the
   * same words as the one shown is left out.
   */
  others: ResponseVersion[];
}

/** One stored version of a response (one row). */
export interface ResponseVersion {
  text: string;
  parts: PartAnswer[] | null;
  at: number;
  /** Exactly what was submitted (not a draft typed after). */
  submitted: boolean;
}

const ENTRY_PREFIX = "exercise-entry:";

const cardKey = (jk: JournalKey, card: ExerciseCardRef) =>
  card.legacy ? exerciseCardKey(jk, card.day!, card.theme) : exerciseCardIdKey(jk, card.id);

async function entryRowId(jk: JournalKey, date: ISODate, card: ExerciseCardRef, deviceId: string): Promise<string> {
  return journalId("exercise-entry", date, `${await cardKey(jk, card)}:${deviceId}`);
}

/**
 * This device's drafts of a card go in their own row (`…:<deviceId>-draft`), never in the row
 * Submit writes, so an autosave can't overwrite what she submitted (Esme, 2026-11-04). Earlier
 * code still reads it: it groups it with the card's other rows, like another device's.
 */
const DRAFT_SUFFIX = "-draft";
const draftRowId = (jk: JournalKey, date: ISODate, card: ExerciseCardRef, deviceId: string) =>
  entryRowId(jk, date, card, `${deviceId}${DRAFT_SUFFIX}`);

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
    case "checklist":
      // Every item has its choice (the second of its [item, choice, note] row); the note is optional.
      return Array.isArray(v) && v.length > 0 && (v as unknown[]).every((r) => Array.isArray(r) && line(r[1]));
    case "rating":
    case "scale":
      return typeof v === "number";
    default:
      return typeof v === "string" && v !== "";
  }
}

/** Anything at all written or chosen (a draft worth keeping and showing). */
const started = (v: unknown): boolean => (Array.isArray(v) ? v.some(started) : typeof v === "string" ? v.trim() !== "" : v !== null);
/** A checklist's rows start with the item's own words, which are not hers: only the choice and note count. */
const partStarted = (a: PartAnswer) =>
  a.kind === "checklist" && Array.isArray(a.answer) ? started((a.answer as unknown[]).map((r) => (Array.isArray(r) ? r.slice(1) : r))) : started(a.answer);

/**
 * Something new in a tracker since `baseline` (the days carried forward from an earlier day):
 * a field filled now that was empty then (review I2: only new input logs a day).
 */
export function trackerNewInput(value: ResponseValue, baseline: ResponseValue | null | undefined): boolean {
  if (typeof value === "string") return false;
  return value.some((a, i) => {
    if (a.kind !== "tracker" || !Array.isArray(a.answer)) return false;
    const before = typeof baseline === "string" || !baseline ? undefined : (baseline.find((b) => b.prompt === a.prompt && b.kind === a.kind) ?? baseline[i]);
    const was = Array.isArray(before?.answer) ? (before!.answer as unknown[]) : [];
    return (a.answer as unknown[]).some((day, d) =>
      Array.isArray(day) && day.some((cell, f) => line(cell) && !line(Array.isArray(was[d]) ? (was[d] as unknown[])[f] : undefined)),
    );
  });
}

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

/**
 * The entry sealed for a card's response: a version 1 card keeps the earlier shape. `prev` is
 * the row being written over: whatever it holds that the new value has no place for (a part the
 * re-imported card no longer has, or its one text once the card has parts) is kept in the new
 * row, so a write never drops anything she wrote.
 */
function responseEntry(
  card: ExerciseCardRef, value: ResponseValue, submittedAt: number | null, at: number, prev: ExerciseResponseEntry | null = null,
): ExerciseResponseEntry {
  let text = typeof value === "string" ? value : "";
  let parts = typeof value === "string" ? undefined : value;
  if (prev && parts) {
    if (text.trim() === "" && prev.text.trim() !== "") text = prev.text;
    const now = parts;
    const kept = prev.v === 2 ? (prev.parts ?? []).filter((p) => partStarted(p) && !now.some((a) => a.prompt === p.prompt && a.kind === p.kind)) : [];
    if (kept.length) parts = [...now, ...kept].slice(0, MAX_PARTS);
  }
  if (card.legacy) return { v: 1, day: card.day!, theme: card.theme, text, submittedAt, at };
  return { v: 2, id: card.id, day: card.day, theme: card.theme, text, ...(parts ? { parts } : {}), submittedAt, at };
}

/** A row holds exactly what was submitted (not a draft typed after a submit). */
const isSubmitted = (r: ExerciseResponseEntry) => r.submittedAt !== null && r.submittedAt === r.at;
const partsOf = (r: ExerciseResponseEntry) => (r.v === 2 ? (r.parts ?? null) : null);
const contentKey = (r: ExerciseResponseEntry) => JSON.stringify([r.text, partsOf(r)]);

/**
 * One card's rows on one day (each device writes its own, and its drafts apart), merged.
 * - "read" (Read back, Past exercises, All cards): the newest SUBMITTED response shows; only
 *   with none, the newest draft. A draft never hides a submitted response (Esme, 2026-11-04).
 * - "edit" (the response box): the newest with anything written, so the box opens on what she
 *   typed last; "Saved" only while that is what was last submitted.
 * Every other version with something written is in `others`: nothing is hidden.
 */
function mergeResponses(date: ISODate, rows: ExerciseResponseEntry[], mode: "read" | "edit" = "read"): ExerciseResponse | null {
  if (rows.length === 0) return null;
  const newest = (list: ExerciseResponseEntry[]) => list.reduce((a, b) => (b.at > a.at ? b : a));
  const filled = rows.filter((r) => hasContent({ text: r.text, parts: partsOf(r) }));
  const sent = filled.filter(isSubmitted);
  const lastSent = sent.length ? newest(sent) : null;
  const best = mode === "read" && lastSent ? lastSent : newest(filled.length ? filled : rows);
  const seen = new Set([contentKey(best)]);
  const others: ResponseVersion[] = [];
  for (const r of [...filled].sort((a, b) => b.at - a.at)) {
    if (seen.has(contentKey(r))) continue;
    seen.add(contentKey(r));
    others.push({ text: r.text, parts: partsOf(r), at: r.at, submitted: isSubmitted(r) });
  }
  return {
    date, id: best.v === 2 ? best.id : legacyCardId(best.day), day: best.day, theme: best.theme, text: best.text,
    parts: partsOf(best), at: best.at,
    saved: isSubmitted(best) || (lastSent !== null && contentKey(lastSent) === contentKey(best)),
    submitted: rows.some((r) => r.submittedAt !== null),
    others,
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
  return { entry: groups[0] ? mergeResponses(date, groups[0].entries, "edit") : null, unreadable };
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
  const id = await draftRowId(jk, date, card, deviceId);
  const prev = await ownResponse(jk, id);
  const entry = responseEntry(card, value, null, Date.now(), prev);
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
  const prev = await ownResponse(jk, id);
  await oneAtATime(async () => {
    const marks = marked(await ownMarks(jk, date, deviceId), todayId, card.id, true);
    const at = Date.now();
    const response = await seal(jk, "exercise-entry", date, id.slice(`${ENTRY_PREFIX}${date}:`.length), responseEntry(card, value, at, at, prev));
    const mark = await seal(jk, "exercise", date, deviceId, { ...marks, at });
    await write(jk, [response, mark]);
  });
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
  const carried = await readLatestExerciseEntry(jk, date, card);
  if (!trackerNewInput(value, carried?.parts)) throw new Error("There is nothing new to save yet.");
  const id = await entryRowId(jk, date, card, deviceId);
  const prev = await ownResponse(jk, id);
  await oneAtATime(async () => {
    const marks = marked(await ownMarks(jk, date, deviceId), todayId, card.id, false, true);
    const at = Date.now();
    const response = await seal(jk, "exercise-entry", date, id.slice(`${ENTRY_PREFIX}${date}:`.length), responseEntry(card, value, at, at, prev));
    const mark = await seal(jk, "exercise", date, deviceId, { ...marks, at });
    await write(jk, [response, mark]);
  });
}

/**
 * The newest response to a card before `date` and since it was last done (a tracker card
 * carries its earlier days forward; a new round starts empty, review M6), or null.
 */
export async function readLatestExerciseEntry(jk: JournalKey, date: ISODate, card: ExerciseCardRef): Promise<ExerciseResponse | null> {
  const key = `:${await cardKey(jk, card)}:`;
  const lastDone = (await readExerciseProgress(jk)).marks
    .filter((m) => m.id === card.id && m.done && m.date < date)
    .reduce<ISODate>((a, m) => (m.date > a ? m.date : a), "");
  const rows = (await db.journal.where("kind").equals("exercise-entry").toArray()).filter(
    (r) => r.date < date && r.date > lastDone && r.id.includes(key),
  );
  const { groups } = await openResponses(jk, rows);
  const all = groups.map((g) => mergeResponses(g.date, g.entries, "edit")!).sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
  return all[0] ?? null;
}

/**
 * Every response before `before` (one per day and card, merged across devices), newest
 * first. Empty drafts are left out; responses are readable any time.
 */
export async function listExerciseEntries(jk: JournalKey, before: ISODate): Promise<{ entries: ExerciseResponse[]; unreadable: number }> {
  const rows = (await db.journal.where("kind").equals("exercise-entry").toArray()).filter((r) => r.date < before);
  const { groups, unreadable } = await openResponses(jk, rows);
  // One entry per card and day, by the card's full id (a version 1 row by its own day and theme,
  // apart from every id'd card): never by day number alone, since two books each have a Day 1
  // (Esme, 2026-11-04).
  const byCard = new Map<string, { date: ISODate; entries: ExerciseResponseEntry[] }>();
  for (const g of groups) {
    const e = g.entries[0]!;
    const k = JSON.stringify(e.v === 2 ? [g.date, "id", e.id] : [g.date, "v1", e.day, e.theme]);
    const have = byCard.get(k);
    if (have) have.entries.push(...g.entries);
    else byCard.set(k, { date: g.date, entries: [...g.entries] });
  }
  const entries = [...byCard.values()]
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
