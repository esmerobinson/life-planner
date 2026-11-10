// What the Together link keeps on this device (Together link brief §1, §2). All of it lives in
// `syncMeta`, which is never synced and never in a backup, so only the device that signed in
// ever sends, and nothing here reaches the Esmeworld sync server or a backup file.
//
// - "together": the sign-in. The Supabase address and anon key, her Together user id and couple
//   id, and the access and refresh tokens with their expiry. Never the password or email.
// - "togetherSent": what has been sent, per day (the parts its note holds and a hash of it), so
//   a run sends only what changed and a replay sends nothing.

import type { HubDB } from "../data/db";
import type { ISODate } from "../domain/types";
import type { Part } from "./journalNotes";

export type { Part };

export const TOGETHER_META = "together";
export const TOGETHER_SENT_META = "togetherSent";

export interface TogetherAuth {
  url: string;
  anonKey: string;
  userId: string;
  coupleId: string;
  /** Absent once a refresh or a request was refused: she must sign in again. */
  accessToken?: string;
  refreshToken?: string;
  /** Epoch ms the access token stops working. */
  expiresAt?: number;
}

/** One day's row in her challenge (`challenge_days`, by our fixed id), as last sent. */
export interface SentDay {
  /**
   * Hash of the note it holds. "" when unknown: written down BEFORE the insert goes (bug #49), so
   * an insert cut off (timed out, reply lost) is never forgotten; the next run overwrites it.
   */
  hash: string;
  /** Not deleted in Together. */
  live: boolean;
  /** The parts it holds, and whether with her answers (an unknown note: taken as answers). */
  parts: Partial<Record<Part, "titles" | "answers">>;
}

/** Why something is set aside: it couldn't be copied, or something couldn't be hidden. */
export interface SetAside {
  hash: string;
  what: "copy" | "hide";
}

/** What an earlier build kept (two habits and their tallies): cleaned up once, then forgotten. */
export interface LegacyHabits {
  habits?: Partial<Record<Part, { tally: number; deleted: boolean }>>;
  /** By `<kind>:<date>`. */
  tallies?: Record<string, { v: number; hash: string; live: boolean; answers?: boolean }>;
  maybe?: Record<string, { key: string; v: number }>;
}

export interface TogetherSent extends LegacyHabits {
  /** The Together user these records belong to (a different account starts afresh). */
  userId: string;
  /** Her first exercise or check-in day (everything from it goes, Esme 2026-11-08). */
  since: ISODate;
  /** Random, for the note hashes. */
  salt: string;
  /** Her challenge in Together ("BPD research", renamed "Mental Health Work"), once found. */
  challenge?: { id: string; renamed?: boolean };
  /** No such challenge was found in Together on the last look: nothing goes. */
  challengeMissing?: boolean;
  /** By date. */
  days?: Record<ISODate, SentDay>;
  /** Days she logged by hand, or deleted our entry for, in Together: left as they are there. */
  byHand?: Record<ISODate, true>;
  /** Set aside after Together refused it (tried again once it changes, or on Send now). */
  refused: Record<string, SetAside>;
  /**
   * Days before this one (the sign-in day, or the day this update first ran) are past days: their
   * answers wait until `pastUntil` (24 h after that moment), so she can tick any old day private.
   */
  pastBefore?: ISODate;
  pastUntil?: number;
  /**
   * The last run found a past day whose answers wait only on `pastUntil` (not on a private tick):
   * the box offers "Send past days' answers now" while that's so.
   */
  pastWaiting?: boolean;
  /** The last run stopped at its limit of writes (a big backfill): the rest goes next run. */
  backlog?: boolean;
  /** The last run (any outcome but offline). */
  lastSentAt?: number;
  /** The last run that could copy: "Last copied" in the box. */
  lastCopiedAt?: number;
  /** Earlier builds only (new days held back behind a refused clean-up); cleared on the next run. */
  held?: boolean;
  /** How many former device ids this device had when last looked at: one more means a Replace. */
  formerSeen?: number;
  /** When a Replace was first noticed (bugs #58, #64, #65); gone once sync has caught up. */
  restoredAt?: number;
  /** Answers are held after a Replace (shown in the box, bug #65). */
  waitingRestore?: boolean;
  /**
   * "Stop copying" with removing began and hasn't finished (bug #53): copying is paused. Runs
   * may only carry on removing; nothing is sent or shown again until she presses Stop again
   * (which finishes it) or cancels.
   */
  removing?: boolean;
}

async function meta<T>(db: HubDB, key: string): Promise<T | undefined> {
  return (await db.syncMeta.get(key))?.value as T | undefined;
}

export const readAuth = (db: HubDB) => meta<TogetherAuth>(db, TOGETHER_META);
export const readSent = (db: HubDB) => meta<TogetherSent>(db, TOGETHER_SENT_META);

export async function saveSent(db: HubDB, sent: TogetherSent): Promise<void> {
  await db.syncMeta.put({ key: TOGETHER_SENT_META, value: sent });
}

/** The Web Lock name for everything that signs in, refreshes or sends (one tab at a time). */
export const togetherLockName = (db: HubDB) => `esmeworld-together:${db.name}`;

/**
 * Runs `fn` holding the Together lock across tabs. With `ifAvailable`, returns null at once
 * when another tab holds it (that tab is already sending).
 */
export async function withTogetherLock<T>(db: HubDB, fn: () => Promise<T>, opts: { ifAvailable?: boolean } = {}): Promise<T | null> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks?.request) {
    return locks.request(togetherLockName(db), { ifAvailable: opts.ifAvailable === true }, async (lock) =>
      lock === null ? null : fn(),
    ) as Promise<T | null>;
  }
  return inTab(fn, opts);
}

/** Without Web Locks (tests, old browsers): one at a time within this tab. */
let queue: Promise<unknown> = Promise.resolve();
let busy = 0;
function inTab<T>(fn: () => Promise<T>, opts: { ifAvailable?: boolean }): Promise<T | null> {
  if (busy > 0 && opts.ifAvailable) return Promise.resolve(null);
  busy++;
  const run = queue.then(fn).finally(() => busy--);
  queue = run.catch(() => undefined);
  return run;
}
