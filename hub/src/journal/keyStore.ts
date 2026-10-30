// Where this device keeps the journal key, and how a key becomes trusted (journal brief §3,
// review C1: never seal with an unverified key).
//
// - A key made from a typed passphrase (Sync page Save, or "Unlock journal") is only a
//   CANDIDATE. A candidate never seals anything.
// - It becomes the CONFIRMED key when either
//   (a) it opens the synced verifier row (a known value sealed with the first confirmed key), or
//   (b) no verifier exists yet AND the sync server has accepted the sync token made from the
//       same passphrase in a successful sync on this device. This device then writes the verifier.
// - A confirmed key is never replaced by a candidate unless the candidate also opens the
//   verifier, and never removed by a refused passphrase (only a candidate is).
// - Refused or superseded candidates are RETIRED (kept, never used to seal), so the repair
//   pass can re-seal any row they once sealed with the confirmed key.
//
// Keys are non-extractable CryptoKeys stored as objects in syncMeta (IndexedDB holds them;
// syncMeta is never synced and never in a backup). The passphrase is never stored or logged.

import type { HubDB } from "../data/db";
import { validJournal } from "../data/validate";
import type { JournalRow } from "../domain/types";
import { deriveToken } from "../sync/token";
import { deriveJournalKeyAndFp, fileAad, journalAad, openBytes, openJson, sealBytes, sealJson, type JournalKey } from "./crypto";

/** syncMeta: the confirmed key `{key, mac, fp, id}`. */
export const JOURNAL_KEY_META = "journalKey";
/** syncMeta: the candidate key `{key, mac, fp, token, id}` waiting to be confirmed. */
export const JOURNAL_CANDIDATE_META = "journalCandidate";
/** syncMeta: retired keys `[{key, mac, fp}]` (never seal; only for the repair pass). */
export const JOURNAL_RETIRED_META = "journalRetired";
/** syncMeta (written by the sync engine): the exact token the server last accepted in a whole run. */
export const ACCEPTED_TOKEN_META = "acceptedToken";

/** The verifier row's id and the value sealed in it. */
export const VERIFIER_ID = "verifier";
const VERIFIER_TEXT = "esmeworld-journal-verifier-v1";
/** How many retired keys are kept. */
const MAX_RETIRED = 5;

export interface StoredJournalKey extends JournalKey {
  /** A random id per stored key, so the UI can tell a replaced key from the same one re-read. */
  id: string;
}

export interface StoredCandidate extends StoredJournalKey {
  /**
   * The sync token derived from the SAME passphrase as this key (null: made by opening the
   * verifier). Rule (b) confirms the candidate only when the server accepted exactly this
   * token, so a second Save finishing in another order can never confirm the wrong key.
   */
  token: string | null;
}

const isKey = (v: unknown): v is StoredJournalKey =>
  !!v && typeof v === "object" && typeof (v as StoredJournalKey).key === "object" &&
  (v as StoredJournalKey).key !== null && typeof (v as StoredJournalKey).mac === "object" &&
  (v as StoredJournalKey).mac !== null && typeof (v as StoredJournalKey).fp === "string";

async function meta<T>(db: HubDB, key: string): Promise<T | undefined> {
  return (await db.syncMeta.get(key))?.value as T | undefined;
}

/** The confirmed key (the only one that may seal), or undefined. */
export async function loadJournalKeyInfo(db: HubDB): Promise<StoredJournalKey | undefined> {
  const v = await meta<StoredJournalKey>(db, JOURNAL_KEY_META);
  return isKey(v) ? v : undefined;
}

/** The confirmed key, or undefined. */
export async function loadJournalKey(db: HubDB): Promise<JournalKey | undefined> {
  const v = await loadJournalKeyInfo(db);
  return v ? { key: v.key, mac: v.mac, fp: v.fp } : undefined;
}

export async function loadCandidate(db: HubDB): Promise<StoredCandidate | undefined> {
  const v = await meta<StoredCandidate>(db, JOURNAL_CANDIDATE_META);
  return isKey(v) ? v : undefined;
}

async function loadRetired(db: HubDB): Promise<JournalKey[]> {
  const v = await meta<unknown[]>(db, JOURNAL_RETIRED_META);
  return Array.isArray(v) ? v.filter(isKey).map((k) => ({ key: k.key, mac: k.mac, fp: k.fp })) : [];
}

/** Moves the candidate (if any) to the retired list, inside the caller's transaction. */
async function retireCandidateIn(db: HubDB): Promise<void> {
  const c = await loadCandidate(db);
  await db.syncMeta.delete(JOURNAL_CANDIDATE_META);
  if (!c) return;
  const confirmed = await loadJournalKeyInfo(db);
  if (confirmed?.fp === c.fp) return; // the same key as the confirmed one: nothing to keep
  const retired = (await loadRetired(db)).filter((k) => k.fp !== c.fp);
  retired.unshift({ key: c.key, mac: c.mac, fp: c.fp });
  await db.syncMeta.put({ key: JOURNAL_RETIRED_META, value: retired.slice(0, MAX_RETIRED) });
}

/**
 * The sync engine, on a refused passphrase (401) for `token`: the candidate made with that
 * passphrase is retired. A confirmed key is never touched. Runs inside the engine's syncMeta
 * transaction.
 */
export async function retireCandidateForToken(db: HubDB, token: string): Promise<void> {
  const c = await loadCandidate(db);
  if (c && c.token === token) await retireCandidateIn(db);
}

/**
 * Stores a candidate. One bound to a sync token is stored only while that token is still the
 * device's sync token: a slower, older Save (another passphrase) finishing late is dropped.
 */
async function storeCandidate(db: HubDB, jk: JournalKey, token: string | null): Promise<boolean> {
  return db.transaction("rw", db.syncMeta, async () => {
    if (token !== null && (await meta<string>(db, "token")) !== token) return false;
    await retireCandidateIn(db); // a superseded candidate is kept for repair, never used
    const value: StoredCandidate = { key: jk.key, mac: jk.mac, fp: jk.fp, token, id: crypto.randomUUID() };
    await db.syncMeta.put({ key: JOURNAL_CANDIDATE_META, value });
    return true;
  });
}

const asStored = (c: StoredCandidate): StoredJournalKey => ({ key: c.key, mac: c.mac, fp: c.fp, id: c.id });

async function opensVerifier(jk: JournalKey, row: JournalRow): Promise<boolean> {
  try {
    const v = await openJson<{ check?: unknown }>(jk.key, row, journalAad(row.id));
    return v?.check === VERIFIER_TEXT;
  } catch {
    return false;
  }
}

async function sealedVerifier(jk: JournalKey, date: string): Promise<JournalRow> {
  const sealed = await sealJson(jk.key, { v: 1, check: VERIFIER_TEXT }, journalAad(VERIFIER_ID));
  return { id: VERIFIER_ID, kind: "verifier", date, fp: jk.fp, ...sealed };
}

const todayStamp = () => new Date().toISOString().slice(0, 10);

export type JournalKeyState = "confirmed" | "checking" | "locked";

/**
 * Tries to confirm the candidate (rules (a) and (b) above), writes the verifier when this
 * device is the first, and runs the repair pass. Safe to call any time (on the Journal page,
 * after Save, after a sync). Returns where this device now stands.
 */
export async function confirmJournalKey(db: HubDB): Promise<JournalKeyState> {
  let confirmed = await loadJournalKeyInfo(db);
  let verifier = await db.journal.get(VERIFIER_ID);
  // A confirmed key with no verifier anywhere here (e.g. after a Replace restore): put it back.
  if (confirmed && !verifier) {
    const row = await sealedVerifier(confirmed, todayStamp());
    await db.transaction("rw", db.journal, db.syncMeta, async () => {
      if (!(await db.journal.get(VERIFIER_ID)) && (await loadJournalKeyInfo(db))?.fp === row.fp) await db.journal.put(row);
    });
    verifier = await db.journal.get(VERIFIER_ID);
  }
  const c = await loadCandidate(db);
  if (c) {
    if (verifier) {
      const ok = await opensVerifier(c, verifier);
      await db.transaction("rw", db.syncMeta, async () => {
        if ((await loadCandidate(db))?.id !== c.id) return;
        if (ok) {
          await db.syncMeta.put({ key: JOURNAL_KEY_META, value: asStored(c) });
          await db.syncMeta.delete(JOURNAL_CANDIDATE_META);
        } else {
          await retireCandidateIn(db); // a typo, or a passphrase other than the journal's
        }
      });
    } else if (!confirmed) {
      const token = await meta<string>(db, "token");
      const accepted = await meta<string>(db, ACCEPTED_TOKEN_META);
      if (!token || c.token === null || token !== c.token) {
        // Its passphrase's token is gone (refused) or replaced: it can never be confirmed.
        await db.transaction("rw", db.syncMeta, async () => {
          if ((await loadCandidate(db))?.id === c.id) await retireCandidateIn(db);
        });
      } else if (accepted === c.token) {
        // The server accepted this passphrase and no device has a verifier: this one writes it.
        const row = await sealedVerifier(c, todayStamp());
        await db.transaction("rw", db.journal, db.syncMeta, async () => {
          if ((await loadCandidate(db))?.id !== c.id || (await db.journal.get(VERIFIER_ID))) return;
          if ((await meta<string>(db, ACCEPTED_TOKEN_META)) !== c.token) return;
          await db.syncMeta.put({ key: JOURNAL_KEY_META, value: asStored(c) });
          await db.syncMeta.delete(JOURNAL_CANDIDATE_META);
          await db.journal.put(row);
        });
      }
    }
  }
  confirmed = await loadJournalKeyInfo(db);
  if (confirmed) {
    await repairJournal(db);
    return "confirmed";
  }
  return (await loadCandidate(db)) ? "checking" : "locked";
}

/**
 * Sync page Save: the passphrase was just turned into the sync token and saved. The journal
 * key from it is stored only as a candidate; it is confirmed by the verifier, or by the
 * server accepting the token (a later sync), never by being typed.
 */
export async function saveJournalKeyFromSync(db: HubDB, passphrase: string): Promise<JournalKeyState> {
  const [jk, token] = await Promise.all([deriveJournalKeyAndFp(passphrase), deriveToken(passphrase)]);
  await storeCandidate(db, jk, token);
  return confirmJournalKey(db);
}

export type UnlockResult = "ok" | "checking" | "wrong" | "no-sync" | "sync-unconfirmed";

/**
 * "Unlock journal".
 * - A verifier is here: the passphrase must open it (nothing else counts).
 * - No verifier yet, a sync token here: the passphrase must give that token. If the server
 *   has not accepted that token yet, a mismatch may mean the Sync page has the typo, so it
 *   says so ("sync-unconfirmed") instead of "wrong". A match is a candidate until the server
 *   accepts the token ("checking").
 * - Neither: "no-sync" (set up sync first).
 */
export async function unlockJournal(db: HubDB, passphrase: string): Promise<UnlockResult> {
  if (!passphrase) return "wrong";
  const verifier = await db.journal.get(VERIFIER_ID);
  if (verifier) {
    const jk = await deriveJournalKeyAndFp(passphrase);
    if (!(await opensVerifier(jk, verifier))) return "wrong";
    await storeCandidate(db, jk, null);
    return (await confirmJournalKey(db)) === "confirmed" ? "ok" : "wrong";
  }
  const token = await meta<string>(db, "token");
  if (typeof token !== "string" || !token) return "no-sync";
  const typed = await deriveToken(passphrase);
  if (typed !== token) return (await meta<string>(db, ACCEPTED_TOKEN_META)) === token ? "wrong" : "sync-unconfirmed";
  if (!(await storeCandidate(db, await deriveJournalKeyAndFp(passphrase), typed))) return "wrong";
  return (await confirmJournalKey(db)) === "confirmed" ? "ok" : "checking";
}

/**
 * Repair pass: rows (and photos) sealed with a key other than the confirmed one are opened
 * with a retired key of the same fingerprint, if this device still has one, and re-sealed
 * with the confirmed key. Rows nothing here can open are left exactly as they are.
 */
export async function repairJournal(db: HubDB): Promise<number> {
  const confirmed = await loadJournalKeyInfo(db);
  if (!confirmed) return 0;
  const retired = await loadRetired(db);
  if (retired.length === 0) return 0;
  const byFp = new Map(retired.map((k) => [k.fp, k]));
  let fixed = 0;
  for (const row of await db.journal.toArray()) {
    const old = row.fp && row.fp !== confirmed.fp ? byFp.get(row.fp) : undefined;
    if (!old) continue;
    try {
      const plain = await openBytes(old.key, row, journalAad(row.id));
      const sealed = await sealBytes(confirmed.key, plain, journalAad(row.id));
      const next: JournalRow = { id: row.id, kind: row.kind, date: row.date, fp: confirmed.fp, ...sealed };
      if (!validJournal(next)) continue;
      const done = await db.transaction("rw", db.journal, db.syncMeta, async () => {
        const now = await db.journal.get(row.id);
        if (now?.updatedAt !== row.updatedAt || (await loadJournalKeyInfo(db))?.fp !== confirmed.fp) return false;
        await db.journal.put(next);
        return true;
      });
      if (done) fixed++;
    } catch {
      /* left as it is */
    }
  }
  for (const f of await db.files.filter((x) => x.encrypted === true && !!x.fp && x.fp !== confirmed.fp).toArray()) {
    const old = byFp.get(f.fp!);
    if (!old || !f.iv) continue;
    try {
      const plain = await openBytes(old.key, { iv: f.iv, ct: f.data }, fileAad(f.id));
      const sealed = await sealBytes(confirmed.key, plain, fileAad(f.id));
      const done = await db.transaction("rw", db.files, db.syncMeta, async () => {
        const now = await db.files.get(f.id);
        if (now?.updatedAt !== f.updatedAt || (await loadJournalKeyInfo(db))?.fp !== confirmed.fp) return false;
        await db.files.put({ ...f, data: sealed.ct, iv: sealed.iv, fp: confirmed.fp });
        return true;
      });
      if (done) fixed++;
    } catch {
      /* left as it is */
    }
  }
  return fixed;
}
