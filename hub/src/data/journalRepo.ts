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
import { journalId, validJournal } from "./validate";
import { fileAad, journalAad, openBytes, openJson, promptKey, sealBytes, sealJson, type JournalKey } from "../journal/crypto";
import { ENTRY_CHECK, MORNING_LOCK_DAYS, type AnswerEntry } from "../journal/entries";
import { JOURNAL_KEY_META } from "../journal/keyStore";
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
