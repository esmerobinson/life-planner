// The journal's reads and writes (journal brief): part of the repo layer (re-exported from
// repo.ts), so every write goes through the change tracker like any other synced row.
//
// Rows are sealed with the journal key before they reach IndexedDB; the plaintext exists
// only in memory. A row that does not open with this device's key (wrong key, tampered,
// or a shape this version does not know) is reported as unreadable and is NEVER written
// over. Morning pages' finished text is not returned to the UI until MORNING_LOCK_DAYS (28)
// days after its date: the calendar reads give only whether the day is done, the current
// draft and the photo ids, and readMorningText refuses (without decrypting) while locked.

import { db } from "./db";
import { addDays } from "../domain/dates";
import { journalId } from "./validate";
import { fileAad, journalAad, openBytes, openJson, sealBytes, sealJson } from "../journal/crypto";
import {
  ENTRY_CHECK, MORNING_LOCK_DAYS, morningDone, type CheckinEntry, type EntryOf, type MorningEntry,
} from "../journal/entries";
import type { FileRow, ISODate, JournalKind, JournalRow } from "../domain/types";

/** Thrown when an entry is there but does not open on this device: nothing is written. */
export const CANT_OPEN = "Can't open this entry on this device";

export type Opened<T> = { state: "none" } | { state: "ok"; entry: T } | { state: "unreadable" };

async function open<K extends JournalKind>(key: CryptoKey, row: JournalRow | undefined, kind: K): Promise<Opened<EntryOf<K>>> {
  if (!row) return { state: "none" };
  try {
    const value = await openJson(key, row, journalAad(row.id));
    if (!(ENTRY_CHECK[kind] as (v: unknown) => boolean)(value)) return { state: "unreadable" };
    return { state: "ok", entry: value as EntryOf<K> };
  } catch {
    return { state: "unreadable" };
  }
}

/**
 * Read, change and write back one entry. The change is sealed outside the database
 * transaction (WebCrypto cannot run inside one); the write then happens only if the row is
 * still the version that was read (a sync may have landed meanwhile), else it starts again.
 */
async function change<K extends JournalKind>(
  key: CryptoKey,
  kind: K,
  date: ISODate,
  fn: (prev: EntryOf<K> | undefined) => EntryOf<K>,
  files: FileRow[] = [],
): Promise<EntryOf<K>> {
  const id = journalId(kind, date);
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await db.journal.get(id);
    const prev = await open(key, row, kind);
    if (prev.state === "unreadable") throw new Error(CANT_OPEN);
    const next = fn(prev.state === "ok" ? prev.entry : undefined);
    const sealed = await sealJson(key, next, journalAad(id));
    const written = await db.transaction("rw", db.journal, db.files, async () => {
      const now = await db.journal.get(id);
      if ((now?.updatedAt ?? null) !== (row?.updatedAt ?? null)) return false;
      if (files.length) await db.files.bulkAdd(files);
      await db.journal.put({ id, kind, date, iv: sealed.iv, ct: sealed.ct });
      return true;
    });
    if (written) return next;
  }
  throw new Error("The journal is busy. Try again.");
}

// ---- morning pages -----------------------------------------------------------------------

/** One day's morning pages as the calendar may see them: never the finished text. */
export interface MorningDay {
  date: ISODate;
  state: "ok" | "unreadable";
  done: boolean;
  pages: number;
  draft: string;
  photos: string[];
}

function morningView(date: ISODate, o: Opened<MorningEntry>): MorningDay {
  if (o.state === "ok") {
    return { date, state: "ok", done: morningDone(o.entry), pages: o.entry.pages, draft: o.entry.draft ?? "", photos: o.entry.photos };
  }
  return { date, state: o.state === "unreadable" ? "unreadable" : "ok", done: false, pages: 0, draft: "", photos: [] };
}

/** Every morning-pages day on this device (for the star calendar and the streak). */
export async function listMorningDays(key: CryptoKey): Promise<MorningDay[]> {
  const rows = await db.journal.where("kind").equals("morning").toArray();
  const days = await Promise.all(rows.map(async (r) => morningView(r.date, await open(key, r, "morning"))));
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

/** One day's morning pages (the writing view's draft, the done box, the photos). */
export async function readMorningDay(key: CryptoKey, date: ISODate): Promise<MorningDay> {
  return morningView(date, await open(key, await db.journal.get(journalId("morning", date)), "morning"));
}

const emptyMorning = (): MorningEntry => ({ v: 1, text: "", pages: 0, photos: [] });

/** The day a morning page's text opens in Read back. */
export const morningOpensOn = (date: ISODate): ISODate => addDays(date, MORNING_LOCK_DAYS);

export type MorningText =
  | { state: "locked"; opensOn: ISODate }
  | { state: "ok"; text: string }
  | { state: "none" }
  | { state: "unreadable" };

/**
 * Read back: a day's finished pages, only once MORNING_LOCK_DAYS have passed since that day
 * (`today` is injected). While locked the row is not even decrypted.
 */
export async function readMorningText(key: CryptoKey, date: ISODate, today: ISODate): Promise<MorningText> {
  const opensOn = morningOpensOn(date);
  if (today < opensOn) return { state: "locked", opensOn };
  const o = await open(key, await db.journal.get(journalId("morning", date)), "morning");
  if (o.state === "unreadable") return { state: "unreadable" };
  if (o.state === "none" || o.entry.pages === 0) return { state: "none" };
  return { state: "ok", text: o.entry.text };
}

/** Autosaves the page being written (sealed). */
export async function saveMorningDraft(key: CryptoKey, date: ISODate, draft: string): Promise<void> {
  await change(key, "morning", date, (prev) => {
    const e = { ...(prev ?? emptyMorning()) };
    if (draft) e.draft = draft;
    else delete e.draft;
    return e;
  });
}

/**
 * "I'm done": the page is added to the day's text (after any earlier pages that day), the
 * draft is cleared and the day gets its star. The text stays hidden for 4 weeks.
 */
export async function finishMorningPage(key: CryptoKey, date: ISODate, text: string): Promise<void> {
  await change(key, "morning", date, (prev) => {
    const e = prev ?? emptyMorning();
    const { draft: _d, ...rest } = e;
    const page = text.trim() ? text : "";
    return { ...rest, text: e.text && page ? `${e.text}\n\n${page}` : e.text || page, pages: e.pages + 1 };
  });
}

/**
 * "Add photo": the downscaled JPEG is sealed and stored as an encrypted file row, and the
 * day lists it (and is done), in ONE transaction. Returns the file id.
 */
export async function addMorningPhoto(
  key: CryptoKey,
  date: ISODate,
  picture: { mime: string; data: string; width: number; height: number },
): Promise<string> {
  const id = crypto.randomUUID();
  const bytes = Uint8Array.from(atob(picture.data), (c) => c.charCodeAt(0));
  const sealed = await sealBytes(key, bytes, fileAad(id));
  const file: FileRow = {
    id, mime: picture.mime, data: sealed.ct, width: picture.width, height: picture.height, createdAt: date,
    encrypted: true, iv: sealed.iv,
  };
  await change(key, "morning", date, (prev) => {
    const e = prev ?? emptyMorning();
    return { ...e, photos: [...e.photos, id] };
  }, [file]);
  return id;
}

/** A journal photo, opened: "missing" until it has synced here, "unreadable" if it won't open. */
export async function openJournalPhoto(
  key: CryptoKey,
  id: string,
): Promise<{ state: "ok"; blob: Blob } | { state: "missing" } | { state: "unreadable" }> {
  const f = await db.files.get(id);
  if (!f || f.status === "purged") return { state: "missing" };
  if (f.encrypted !== true || !f.iv) return { state: "unreadable" };
  try {
    const bytes = await openBytes(key, { iv: f.iv, ct: f.data }, fileAad(f.id));
    return { state: "ok", blob: new Blob([bytes as BlobPart], { type: f.mime }) };
  } catch {
    return { state: "unreadable" };
  }
}

// ---- check-in ----------------------------------------------------------------------------

export interface CheckinDay {
  date: ISODate;
  opened: Opened<CheckinEntry>;
}

/** One day's check-in. */
export async function readCheckin(key: CryptoKey, date: ISODate): Promise<Opened<CheckinEntry>> {
  return open(key, await db.journal.get(journalId("checkin", date)), "checkin");
}

/** Every check-in on this device, newest first (Past check-ins; the rotation's history). */
export async function listCheckins(key: CryptoKey): Promise<CheckinDay[]> {
  const rows = await db.journal.where("kind").equals("checkin").toArray();
  const days = await Promise.all(rows.map(async (r) => ({ date: r.date, opened: await open(key, r, "checkin") })));
  return days.sort((a, b) => b.date.localeCompare(a.date));
}

/** Saves a day's check-in (prompts, answers, where she is up to). */
export async function saveCheckin(key: CryptoKey, date: ISODate, entry: Omit<CheckinEntry, "v">): Promise<void> {
  if (entry.answers.length !== entry.prompts.length) throw new Error("one answer per question");
  await change(key, "checkin", date, () => ({ v: 1, ...entry }));
}
