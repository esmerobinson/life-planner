// What the Together link keeps on this device (Together link brief §1, §2). All of it lives in
// `syncMeta`, which is never synced and never in a backup, so only the device that signed in
// ever sends, and nothing here reaches the Esmeworld sync server or a backup file.
//
// - "together": the sign-in. The Supabase address and anon key, her Together user id and couple
//   id, and the access and refresh tokens with their expiry. Never the password or email.
// - "togetherSent": what has been sent, per day (its version and a hash of the note that went),
//   so a run sends only what changed and a replay sends nothing.

import type { HubDB } from "../data/db";
import type { ISODate } from "../domain/types";

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

/** One day's tally, as last sent. */
export interface SentTally {
  v: number;
  /** Hash of the note it carries. */
  hash: string;
  live: boolean;
}

export interface SentHabit {
  /** `todos.tally` as last sent. */
  tally: number;
  deleted: boolean;
}

export type HabitKind = "exercise" | "checkin";

/** Why something is set aside: it couldn't be copied, or an old tally couldn't be hidden. */
export interface SetAside {
  hash: string;
  what: "copy" | "hide";
}

export interface TogetherSent {
  /** The Together user these records belong to (a different account starts afresh). */
  userId: string;
  /** The first day copied: nothing journalled before it goes. */
  since: ISODate;
  /** Random, for the note hashes. */
  salt: string;
  habits: Partial<Record<HabitKind, SentHabit>>;
  /** By `<kind>:<date>`. */
  tallies: Record<string, SentTally>;
  /** Set aside after Together refused it (tried again once it changes, or on Send now). */
  refused: Record<string, SetAside>;
  /**
   * Tallies that may be in Together but aren't recorded as sent (bug #49): written here BEFORE
   * each insert, by fixed id, so a request cut off (timed out, aborted, reply lost) is never
   * forgotten. Each is deleted in Together before anything new goes, and by Stop with removing;
   * an entry goes only once Together confirms that tally is gone (or was never there), or once
   * the insert is confirmed and the tally is recorded as sent.
   */
  maybe?: Record<string, { key: string; v: number }>;
  lastSentAt?: number;
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
