// Where this device keeps the journal key, and how a key becomes trusted (journal brief §3,
// review C1: never seal with an unverified key).
//
// - A key made from a typed passphrase (Sync page Save, or "Unlock journal") is only a
//   CANDIDATE. A candidate never seals anything.
// - It becomes the CONFIRMED key when either
//   (a) it opens the synced verifier row (a known value sealed with the first confirmed key),
//       or the verifier carries its fingerprint but is damaged (then it is sealed afresh), or
//   (b) no verifier exists yet AND the sync server has accepted the sync token made from the
//       same passphrase in a successful sync on this device. This device then writes the verifier.
// - A confirmed key is never replaced by a candidate unless the candidate also opens the
//   verifier, and never removed by a refused passphrase (only a candidate is).
// - Refused or superseded candidates are DROPPED: they never sealed anything. Only a key that
//   was once confirmed is RETIRED (kept, never used to seal), so the repair pass can re-seal
//   the rows it sealed with the confirmed key.
//
// Keys are non-extractable CryptoKeys stored as objects in syncMeta (IndexedDB holds them;
// syncMeta is never synced and never in a backup). The passphrase is never stored or logged.
//
// Changing the sync passphrase (bugs #3, #4; journal-rekey brief). The journal key never
// changes: it is made from the journal SECRET S (crypto.ts), the bits of the FIRST passphrase.
// - Every key confirmed here from a typed passphrase also keeps this device's copy of S,
//   sealed with a device-only, non-extractable "device wrap key" (never synced, never backed up).
// - Sync page Save also keeps the passphrase's key-wrap key (KEK) as a "pending wrap", bound to
//   its sync token. Once the server has accepted exactly that token in a sync that finished
//   after it was saved, a device whose confirmed key opens the verifier writes the synced row
//   `keywrap:<kekFp>`: S sealed with that KEK. A refused (typo'd) token never gets one.
// - A candidate that doesn't open the verifier is confirmed from its passphrase's keywrap row
//   when one opens and the S inside opens the verifier (rule (a) through the wrap).
// - Rule (b) needs an acceptance that is FRESH: from a sync that finished after the candidate
//   was made (for a Save: after its token was saved). A remembered older acceptance can't
//   confirm a key the server has since stopped accepting (bug #4).
// - A confirmed key stops sealing only on positive evidence that ANOTHER key won: the synced
//   verifier carries a different fingerprint. It is retired and the device goes back to
//   "locked", so the repair pass re-seals its rows later. A verifier with this key's own
//   fingerprint that won't open is DAMAGED (the same key sealed it): it is sealed afresh with
//   the confirmed key and nothing locks (re-key review I1). A key that can't decrypt at all
//   right now (a WebCrypto or keychain refusal) changes nothing.

import type { HubDB } from "../data/db";
import { validJournal } from "../data/validate";
import type { JournalRow } from "../domain/types";
import { deriveToken } from "../sync/token";
import { JOURNAL_KEY_LOST_META } from "./unreadableKeys";
import {
  deriveJournalSecret, deriveKeyWrapKey, fileAad, fromBase64, generateDeviceWrapKey, journalAad, journalKeyFromSecret, openBytes,
  openJson, SECRET_BYTES, sealBytes, sealJson, toBase64, type JournalKey, type KeyWrapKey, type Sealed,
} from "./crypto";

/** syncMeta: the confirmed key `{key, mac, fp, id}`. */
export const JOURNAL_KEY_META = "journalKey";
/** syncMeta: the candidate key `{key, mac, fp, token, id}` waiting to be confirmed. */
export const JOURNAL_CANDIDATE_META = "journalCandidate";
/** syncMeta: retired keys `[{key, mac, fp}]` (never seal; only for the repair pass). */
export const JOURNAL_RETIRED_META = "journalRetired";
/** syncMeta (written by the sync engine): the exact token the server last accepted in a whole run. */
export const ACCEPTED_TOKEN_META = "acceptedToken";
/**
 * syncMeta (written by the sync engine): counts runs that ended with the token accepted. A
 * counter, not a clock time, so a device clock set back can't make an old acceptance look new.
 */
export const ACCEPTED_SEQ_META = "acceptedSeq";
/** syncMeta (written by the sync engine): `acceptedSeq` when the current token was saved. */
export const TOKEN_SEQ_META = "tokenSeq";
/** syncMeta: this device's own key that seals its copy of S. Non-extractable; never leaves. */
export const JOURNAL_DEVICE_WRAP_META = "journalDeviceWrap";
/** syncMeta: the KEK of a passphrase saved on the Sync page, waiting to be written as a wrap. */
export const JOURNAL_PENDING_WRAP_META = "journalPendingWrap";

/** The synced row kind holding S sealed with one passphrase's KEK. */
export const KEYWRAP_KIND = "keywrap";
/** A keywrap row's id: `keywrap:<kekFp>`. */
export const keyWrapId = (kekFp: string) => `${KEYWRAP_KIND}:${kekFp}`;
/** What this device's copy of S is bound to (the journal key it makes). */
const deviceAad = (fp: string) => `device-secret|${fp}`;

/** The verifier row's id and the value sealed in it. */
export const VERIFIER_ID = "verifier";
const VERIFIER_TEXT = "esmeworld-journal-verifier-v1";
/** How many retired keys are kept. */
const MAX_RETIRED = 5;

export interface StoredJournalKey extends JournalKey {
  /** A random id per stored key, so the UI can tell a replaced key from the same one re-read. */
  id: string;
  /**
   * This device's copy of S, sealed with the device wrap key. Absent on a key confirmed by an
   * app version before the re-key update (or when it was made without a passphrase).
   */
  s?: Sealed;
}

export interface StoredCandidate extends StoredJournalKey {
  /**
   * The sync token derived from the SAME passphrase as this key (null: made by opening the
   * verifier). Rule (b) confirms the candidate only when the server accepted exactly this
   * token, so a second Save finishing in another order can never confirm the wrong key.
   */
  token: string | null;
  /**
   * `acceptedSeq` when it was made (for a Save: when its token was saved). Rule (b) needs a
   * later acceptance. Absent on a candidate stored before the re-key update: counts as 0.
   */
  seq?: number;
  /** Its passphrase's KEK and fingerprint, to look for that passphrase's keywrap row. */
  kek?: CryptoKey;
  kekFp?: string;
}

/** A Sync page passphrase's KEK, waiting for the server to accept its token (brief point 4). */
interface PendingWrap {
  kek: CryptoKey;
  kekFp: string;
  /** The journal fingerprint the passphrase itself makes (equal to the journal's: no wrap needed). */
  fp: string;
  token: string;
  /** `acceptedSeq` when its token was saved: only a later acceptance counts. */
  seq: number;
  id: string;
}

const isCryptoKey = (v: unknown): v is CryptoKey => !!v && typeof v === "object" && "algorithm" in (v as object);

const isPendingWrap = (v: unknown): v is PendingWrap =>
  !!v && typeof v === "object" && isCryptoKey((v as PendingWrap).kek) && typeof (v as PendingWrap).kekFp === "string" &&
  typeof (v as PendingWrap).fp === "string" && typeof (v as PendingWrap).token === "string" &&
  typeof (v as PendingWrap).seq === "number" && typeof (v as PendingWrap).id === "string";

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

/**
 * True when this device has a confirmed key stored but it can't be read back. WebKit
 * (WKWebView, Safari) unwraps a stored CryptoKey with a master key; if that isn't the master
 * key it was stored with, the row comes back empty although it is there. In the Mac app that
 * is a key stored by a build that used the macOS keychain's master key (since 2026-11-02 the
 * app supplies its own). Unlocking again overwrites it. Counts the row by its id only (that
 * never unwraps anything). Never changes anything.
 */
export async function journalKeyUnreadable(db: HubDB): Promise<boolean> {
  // A key found unreadable at start-up was removed and leaves a note (unreadableKeys.ts).
  const lost = (await meta<boolean>(db, JOURNAL_KEY_LOST_META)) === true;
  const n = await db.syncMeta.where(":id").equals(JOURNAL_KEY_META).count();
  return (lost || n > 0) && !(await loadJournalKeyInfo(db));
}

/**
 * Errors that mean WebCrypto or the keychain step refused the key (storing or reading a
 * CryptoKey, wrapping/unwrapping it), as opposed to e.g. a full disk.
 */
export function isKeychainError(e: unknown): boolean {
  const name = e instanceof Error || (typeof DOMException !== "undefined" && e instanceof DOMException) ? (e as Error).name : "";
  const message = e instanceof Error || (typeof DOMException !== "undefined" && e instanceof DOMException) ? (e as Error).message : String(e ?? "");
  return (
    ["DataCloneError", "OperationError", "InvalidAccessError", "NotAllowedError", "NotSupportedError"].includes(name) ||
    /keychain|crypto ?key|webcrypto|master key|unwrap|could not be cloned|can ?not be cloned/i.test(message)
  );
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

async function loadPendingWrap(db: HubDB): Promise<PendingWrap | undefined> {
  const v = await meta<PendingWrap>(db, JOURNAL_PENDING_WRAP_META);
  return isPendingWrap(v) ? v : undefined;
}

/** Adds a key to the retired list (never seals; the repair pass only), inside the caller's transaction. */
async function retireKeyIn(db: HubDB, k: JournalKey): Promise<void> {
  const retired = (await loadRetired(db)).filter((r) => r.fp !== k.fp);
  retired.unshift({ key: k.key, mac: k.mac, fp: k.fp });
  await db.syncMeta.put({ key: JOURNAL_RETIRED_META, value: retired.slice(0, MAX_RETIRED) });
}

/**
 * Drops the candidate (if any), inside the caller's transaction. A candidate never sealed
 * anything (C1), so there is nothing for the repair pass to re-seal with it; keeping it would
 * only push keys that once sealed rows out of the retired list (re-key review M1).
 */
async function dropCandidateIn(db: HubDB): Promise<void> {
  await db.syncMeta.delete(JOURNAL_CANDIDATE_META);
}

/**
 * The sync engine, on a refused passphrase (401) for `token`: the candidate made with that
 * passphrase is dropped, and so is its pending wrap (a refused passphrase never gets a
 * wrap). A confirmed key is never touched. Runs inside the engine's syncMeta transaction.
 */
export async function retireCandidateForToken(db: HubDB, token: string): Promise<void> {
  const c = await loadCandidate(db);
  if (c && c.token === token) await dropCandidateIn(db);
  if ((await loadPendingWrap(db))?.token === token) await db.syncMeta.delete(JOURNAL_PENDING_WRAP_META);
}

/** This device's wrap key for its copy of S (made once, here only). */
async function deviceWrapKey(db: HubDB): Promise<CryptoKey> {
  const have = await meta<CryptoKey>(db, JOURNAL_DEVICE_WRAP_META);
  if (isCryptoKey(have)) return have;
  const fresh = await generateDeviceWrapKey();
  return db.transaction("rw", db.syncMeta, async () => {
    const now = await meta<CryptoKey>(db, JOURNAL_DEVICE_WRAP_META);
    if (isCryptoKey(now)) return now;
    await db.syncMeta.put({ key: JOURNAL_DEVICE_WRAP_META, value: fresh });
    return fresh;
  });
}

/** S sealed for this device only. */
async function sealForDevice(db: HubDB, s: Uint8Array, fp: string): Promise<Sealed> {
  return sealBytes(await deviceWrapKey(db), s, deviceAad(fp));
}

/**
 * This device's copy of S for a stored key, checked to make exactly that key; undefined when
 * there is none (a key confirmed before the update) or it can't be opened (e.g. the device
 * wrap key was lost). The caller wipes it after use.
 */
async function deviceSecret(db: HubDB, k: StoredJournalKey): Promise<Uint8Array | undefined> {
  if (!k.s) return undefined;
  const wrap = await meta<CryptoKey>(db, JOURNAL_DEVICE_WRAP_META);
  if (!isCryptoKey(wrap)) return undefined;
  try {
    const s = await openBytes(wrap, k.s, deviceAad(k.fp));
    if (s.length === SECRET_BYTES && (await journalKeyFromSecret(s)).fp === k.fp) return s;
    s.fill(0);
  } catch {
    /* none usable */
  }
  return undefined;
}

/** A passphrase turned into its journal key and S (one PBKDF2). */
async function fromPassphrase(passphrase: string): Promise<{ jk: JournalKey; s: Uint8Array }> {
  const s = await deriveJournalSecret(passphrase);
  return { jk: await journalKeyFromSecret(s), s };
}

/**
 * The keywrap row for a KEK, opened: S and the journal key it makes. Undefined when there is
 * no such row, it doesn't open with this KEK, or what's inside doesn't hold together.
 */
async function openWrap(db: HubDB, kek: CryptoKey, kekFp: string): Promise<{ jk: JournalKey; s: Uint8Array } | undefined> {
  const row = await db.journal.get(keyWrapId(kekFp));
  if (!row || row.kind !== KEYWRAP_KIND) return undefined;
  try {
    const v = await openJson<{ v?: unknown; s?: unknown; fp?: unknown }>(kek, row, journalAad(row.id));
    if (v?.v !== 1 || typeof v.s !== "string" || typeof v.fp !== "string") return undefined;
    const s = fromBase64(v.s);
    if (s.length !== SECRET_BYTES) return undefined;
    const jk = await journalKeyFromSecret(s);
    if (jk.fp !== v.fp) {
      s.fill(0);
      return undefined;
    }
    return { jk, s };
  } catch {
    return undefined;
  }
}

/** Which acceptance a new candidate needs to beat (see StoredCandidate.seq). */
type Fresh = "since-token-saved" | "from-now";

/**
 * Stores a candidate. One bound to a sync token is stored only while that token is still the
 * device's sync token: a slower, older Save (another passphrase) finishing late is dropped.
 * A Save's candidate (`kek` given) also stores its passphrase's pending wrap.
 */
async function storeCandidate(
  db: HubDB,
  m: { jk: JournalKey; s?: Uint8Array; kek?: KeyWrapKey },
  token: string | null,
  fresh: Fresh = "from-now",
): Promise<boolean> {
  const sealed = m.s ? await sealForDevice(db, m.s, m.jk.fp) : undefined;
  return db.transaction("rw", db.syncMeta, async () => {
    if (token !== null && (await meta<string>(db, "token")) !== token) return false;
    await dropCandidateIn(db); // a superseded candidate never sealed anything
    await db.syncMeta.delete(JOURNAL_KEY_LOST_META); // she typed the passphrase again
    const accepted = (await meta<number>(db, ACCEPTED_SEQ_META)) ?? 0;
    const tokenSeq = await meta<number>(db, TOKEN_SEQ_META);
    const seq = fresh === "since-token-saved" && typeof tokenSeq === "number" ? Math.min(tokenSeq, accepted) : accepted;
    const value: StoredCandidate = {
      key: m.jk.key, mac: m.jk.mac, fp: m.jk.fp, token, id: crypto.randomUUID(), seq,
      ...(sealed ? { s: sealed } : {}),
      ...(m.kek ? { kek: m.kek.key, kekFp: m.kek.fp } : {}),
    };
    await db.syncMeta.put({ key: JOURNAL_CANDIDATE_META, value });
    if (m.kek && token !== null) {
      const pending: PendingWrap = { kek: m.kek.key, kekFp: m.kek.fp, fp: m.jk.fp, token, seq, id: crypto.randomUUID() };
      await db.syncMeta.put({ key: JOURNAL_PENDING_WRAP_META, value: pending });
    }
    return true;
  });
}

const asStored = (c: StoredCandidate): StoredJournalKey => ({
  key: c.key, mac: c.mac, fp: c.fp, id: c.id, ...(c.s ? { s: c.s } : {}),
});

async function opensVerifier(jk: JournalKey, row: JournalRow): Promise<boolean> {
  try {
    const v = await openJson<{ check?: unknown }>(jk.key, row, journalAad(row.id));
    return v?.check === VERIFIER_TEXT;
  } catch {
    return false;
  }
}

/**
 * How a key stands against the synced verifier:
 * - "opens": it opens it.
 * - "other-key": it carries another fingerprint (another key sealed it).
 * - "damaged": it carries THIS key's fingerprint (so this key sealed it) and this key works,
 *   but the row won't open: the row itself is damaged.
 * - "key-fails": this key's fingerprint, but this key can't encrypt and decrypt right now
 *   (WebCrypto or the keychain refused): nothing can be concluded about the row.
 */
type VerifierCheck = "opens" | "other-key" | "damaged" | "key-fails";

async function checkVerifier(jk: JournalKey, row: JournalRow): Promise<VerifierCheck> {
  if (await opensVerifier(jk, row)) return "opens";
  if (row.fp !== jk.fp) return "other-key";
  return (await keyWorks(jk)) ? "damaged" : "key-fails";
}

/** The verifier says this is the journal's key: it opens it, or it is that key's own damaged copy. */
async function verifierAccepts(jk: JournalKey, row: JournalRow): Promise<boolean> {
  const check = await checkVerifier(jk, row);
  return check === "opens" || check === "damaged";
}

/** This key seals and opens a throwaway value (nothing stored). */
async function keyWorks(jk: JournalKey): Promise<boolean> {
  try {
    const probe = await sealJson(jk.key, { probe: 1 }, "probe");
    return (await openJson<{ probe?: unknown }>(jk.key, probe, "probe"))?.probe === 1;
  } catch {
    return false;
  }
}

/**
 * The confirmed key against the synced verifier: retired when another key's verifier won
 * (bug #4); the verifier sealed afresh when it is this key's own damaged copy (review I1).
 */
async function settleVerifier(db: HubDB): Promise<void> {
  const confirmed = await loadJournalKeyInfo(db);
  const verifier = await db.journal.get(VERIFIER_ID);
  if (!confirmed || !verifier) return;
  const check = await checkVerifier(confirmed, verifier);
  if (check === "other-key") {
    // Another key's verifier won: this key stops sealing. Its rows stay as they are; kept as
    // retired, the repair pass re-seals them once the right key is confirmed here.
    await db.transaction("rw", db.journal, db.syncMeta, async () => {
      if ((await loadJournalKeyInfo(db))?.id !== confirmed.id || (await db.journal.get(VERIFIER_ID))?.updatedAt !== verifier.updatedAt) return;
      await retireKeyIn(db, confirmed);
      await db.syncMeta.delete(JOURNAL_KEY_META);
    });
  } else if (check === "damaged") {
    // The only row ever written over without being opened: its fingerprint says this very key
    // sealed it, and this key works, so the row is damaged and a fresh copy is the same check.
    const row = await sealedVerifier(confirmed, todayStamp());
    await db.transaction("rw", db.journal, db.syncMeta, async () => {
      if ((await loadJournalKeyInfo(db))?.fp !== confirmed.fp || (await db.journal.get(VERIFIER_ID))?.updatedAt !== verifier.updatedAt) return;
      await db.journal.put(row);
    });
  }
}

async function sealedVerifier(jk: JournalKey, date: string): Promise<JournalRow> {
  const sealed = await sealJson(jk.key, { v: 1, check: VERIFIER_TEXT }, journalAad(VERIFIER_ID));
  return { id: VERIFIER_ID, kind: "verifier", date, fp: jk.fp, ...sealed };
}

const todayStamp = () => new Date().toISOString().slice(0, 10);

/** The server accepted exactly `token` in a sync that finished after `seq`, and it is still the token here. */
async function freshlyAccepted(db: HubDB, token: string | null, seq: number | undefined): Promise<boolean> {
  if (token === null) return false;
  return (
    (await meta<string>(db, "token")) === token &&
    (await meta<string>(db, ACCEPTED_TOKEN_META)) === token &&
    ((await meta<number>(db, ACCEPTED_SEQ_META)) ?? 0) > (seq ?? 0)
  );
}

/** Makes `k` the confirmed key, keeping an existing copy of S for the same key if `k` has none. In a transaction. */
async function confirmIn(db: HubDB, k: StoredJournalKey): Promise<void> {
  const before = await loadJournalKeyInfo(db);
  const s = k.s ?? (before?.fp === k.fp ? before.s : undefined);
  await db.syncMeta.put({ key: JOURNAL_KEY_META, value: { key: k.key, mac: k.mac, fp: k.fp, id: k.id, ...(s ? { s } : {}) } });
}

export type JournalKeyState = "confirmed" | "checking" | "locked";

/**
 * Tries to confirm the candidate (rules (a) and (b) above, and (a) through a keywrap row),
 * writes the verifier when this device is the first, writes a pending wrap the server has
 * accepted, and runs the repair pass. Safe to call any time (on the Journal page, after Save,
 * after a sync). Returns where this device now stands.
 */
export async function confirmJournalKey(db: HubDB): Promise<JournalKeyState> {
  await settleVerifier(db);
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
      let found: StoredJournalKey | undefined;
      if (await verifierAccepts(c, verifier)) found = asStored(c);
      else if (c.kek && c.kekFp) found = await keyFromWrap(db, c.kek, c.kekFp, verifier);
      await db.transaction("rw", db.syncMeta, async () => {
        if ((await loadCandidate(db))?.id !== c.id) return;
        if (found) {
          await confirmIn(db, found);
          await db.syncMeta.delete(JOURNAL_CANDIDATE_META);
          // The candidate's own key (when it came through a wrap) never sealed anything: dropped.
        } else {
          await dropCandidateIn(db); // a typo, or a passphrase with no wrap (yet)
        }
      });
    } else if (!confirmed) {
      const token = await meta<string>(db, "token");
      if (!token || c.token === null || token !== c.token) {
        // Its passphrase's token is gone (refused) or replaced: it can never be confirmed.
        await db.transaction("rw", db.syncMeta, async () => {
          if ((await loadCandidate(db))?.id === c.id) await dropCandidateIn(db);
        });
      } else if (await freshlyAccepted(db, c.token, c.seq)) {
        // The server accepted this passphrase (in a sync after it was typed) and no device has
        // a verifier: this one writes it.
        const row = await sealedVerifier(c, todayStamp());
        await db.transaction("rw", db.journal, db.syncMeta, async () => {
          if ((await loadCandidate(db))?.id !== c.id || (await db.journal.get(VERIFIER_ID))) return;
          if (!(await freshlyAccepted(db, c.token, c.seq))) return;
          await confirmIn(db, asStored(c));
          await db.syncMeta.delete(JOURNAL_CANDIDATE_META);
          await db.journal.put(row);
        });
      }
    }
  }
  // A Sync page passphrase whose candidate was retired before its wrap arrived (she typed the
  // new passphrase here before on a device where the journal was open): the wrap opens it now.
  const pending = await loadPendingWrap(db);
  if (!(await loadJournalKeyInfo(db)) && verifier && pending) {
    const found = await keyFromWrap(db, pending.kek, pending.kekFp, verifier);
    if (found) {
      await db.transaction("rw", db.syncMeta, async () => {
        if ((await loadJournalKeyInfo(db)) || (await loadPendingWrap(db))?.id !== pending.id) return;
        await confirmIn(db, found);
      });
    }
  }
  await settleVerifier(db); // a key just confirmed against a damaged verifier seals it afresh
  confirmed = await loadJournalKeyInfo(db);
  if (confirmed) {
    await writeAcceptedKeyWrap(db);
    await repairJournal(db);
    return "confirmed";
  }
  return (await loadCandidate(db)) ? "checking" : "locked";
}

/** The journal key from a KEK's keywrap row, if its S opens the verifier, with this device's copy of S. */
async function keyFromWrap(db: HubDB, kek: CryptoKey, kekFp: string, verifier: JournalRow): Promise<StoredJournalKey | undefined> {
  const w = await openWrap(db, kek, kekFp);
  if (!w) return undefined;
  try {
    if (!(await verifierAccepts(w.jk, verifier))) return undefined; // another journal's secret: ignored
    return { ...w.jk, id: crypto.randomUUID(), s: await sealForDevice(db, w.s, w.jk.fp) };
  } finally {
    w.s.fill(0);
  }
}

/**
 * Writes the keywrap row for the pending wrap, when the server has freshly accepted its token
 * and this device's confirmed key (which opens the verifier) has its copy of S. Drops the
 * pending wrap once nothing is left to do. Called after every sync that ends "ok" and by
 * confirmJournalKey. True when it wrote a row (the engine then syncs again to send it).
 */
export async function writeAcceptedKeyWrap(db: HubDB): Promise<boolean> {
  const p = await loadPendingWrap(db);
  const confirmed = await loadJournalKeyInfo(db);
  if (!p || !confirmed) return false;
  const drop = () =>
    db.transaction("rw", db.syncMeta, async () => {
      if ((await loadPendingWrap(db))?.id === p.id) await db.syncMeta.delete(JOURNAL_PENDING_WRAP_META);
    });
  if (p.fp === confirmed.fp) {
    await drop(); // the journal's own passphrase: it opens the journal without a wrap
    return false;
  }
  if (!(await freshlyAccepted(db, p.token, p.seq))) return false;
  const verifier = await db.journal.get(VERIFIER_ID);
  if (!verifier || !(await verifierAccepts(confirmed, verifier))) return false;
  const id = keyWrapId(p.kekFp);
  const existing = await db.journal.get(id);
  if (existing) {
    const w = await openWrap(db, p.kek, p.kekFp);
    w?.s.fill(0);
    // Already there (another device wrote it), or a row this KEK can't open: never written over.
    if (!w || w.jk.fp === confirmed.fp) {
      await drop();
      return false;
    }
  }
  const s = await deviceSecret(db, confirmed);
  if (!s) return false; // a key from before the update: the old passphrase is asked for once
  let row: JournalRow;
  try {
    row = { id, kind: KEYWRAP_KIND, date: todayStamp(), fp: p.kekFp, ...(await sealJson(p.kek, { v: 1, s: toBase64(s), fp: confirmed.fp }, journalAad(id))) };
  } finally {
    s.fill(0);
  }
  if (!validJournal(row)) return false;
  return db.transaction("rw", db.journal, db.syncMeta, async () => {
    if ((await loadPendingWrap(db))?.id !== p.id) return false;
    if ((await loadJournalKeyInfo(db))?.fp !== confirmed.fp) return false; // only the confirmed key's S
    if ((await db.journal.get(id))?.updatedAt !== existing?.updatedAt) return false; // changed meanwhile
    await db.journal.put(row);
    await db.syncMeta.delete(JOURNAL_PENDING_WRAP_META);
    return true;
  });
}

/**
 * True when the server has accepted a new passphrase saved here, but this device's journal key
 * was confirmed before the re-key update, so it has no copy of S to write that passphrase's
 * wrap: the Sync page and Journal ask once for the old passphrase (brief point 5).
 */
export async function journalNeedsOldPassphrase(db: HubDB): Promise<boolean> {
  const p = await loadPendingWrap(db);
  const confirmed = await loadJournalKeyInfo(db);
  if (!p || !confirmed || p.fp === confirmed.fp) return false;
  if (!(await freshlyAccepted(db, p.token, p.seq))) return false;
  // Only a wrap that opens to THIS journal counts (one holding another journal's secret is
  // replaced once S is here, re-key review M2).
  // A row there that this KEK can't open is never written over, so asking would achieve nothing.
  if (await db.journal.get(keyWrapId(p.kekFp))) {
    const w = await openWrap(db, p.kek, p.kekFp);
    w?.s.fill(0);
    if (!w || w.jk.fp === confirmed.fp) return false;
  }
  const s = await deviceSecret(db, confirmed);
  s?.fill(0);
  return !s;
}

/**
 * The old-passphrase prompt: a passphrase that gives this device's confirmed journal key
 * (the journal's first passphrase, or any passphrase with a wrap here) stores this device's
 * copy of S and writes the pending wrap. "wrong" for anything else; nothing changes then.
 */
export async function giveOldPassphrase(db: HubDB, passphrase: string): Promise<"ok" | "wrong"> {
  const confirmed = await loadJournalKeyInfo(db);
  if (!passphrase || !confirmed) return "wrong";
  const m = await fromPassphrase(passphrase);
  let s: Uint8Array | undefined = m.s;
  if (m.jk.fp !== confirmed.fp) {
    m.s.fill(0);
    const kek = await deriveKeyWrapKey(passphrase);
    const w = await openWrap(db, kek.key, kek.fp);
    s = w && w.jk.fp === confirmed.fp ? w.s : (w?.s.fill(0), undefined);
  }
  if (!s) return "wrong";
  let sealed: Sealed;
  try {
    sealed = await sealForDevice(db, s, confirmed.fp);
  } finally {
    s.fill(0);
  }
  const stored = await db.transaction("rw", db.syncMeta, async () => {
    const now = await loadJournalKeyInfo(db);
    if (now?.id !== confirmed.id) return false;
    await db.syncMeta.put({ key: JOURNAL_KEY_META, value: { ...now, s: sealed } });
    return true;
  });
  if (!stored) return "wrong";
  await writeAcceptedKeyWrap(db);
  return "ok";
}

/**
 * Sync page Save: the passphrase was just turned into the sync token and saved. The journal
 * key from it is stored only as a candidate; it is confirmed by the verifier (directly or
 * through its keywrap row), or by the server accepting the token (a later sync), never by
 * being typed. Its KEK waits as the pending wrap.
 */
export async function saveJournalKeyFromSync(db: HubDB, passphrase: string): Promise<JournalKeyState> {
  const [m, kek, token] = await Promise.all([fromPassphrase(passphrase), deriveKeyWrapKey(passphrase), deriveToken(passphrase)]);
  try {
    await storeCandidate(db, { ...m, kek }, token, "since-token-saved");
  } finally {
    m.s.fill(0);
  }
  return confirmJournalKey(db);
}

export type UnlockResult = "ok" | "checking" | "wrong" | "no-sync" | "sync-unconfirmed";

/**
 * "Unlock journal".
 * - A verifier is here: the passphrase must open it, directly or through its keywrap row
 *   (a passphrase she changed to). Nothing else counts.
 * - No verifier yet, a sync token here: the passphrase must give that token. If the server
 *   has not accepted that token yet, a mismatch may mean the Sync page has the typo, so it
 *   says so ("sync-unconfirmed") instead of "wrong". A match is a candidate until the server
 *   accepts the token in a later sync ("checking").
 * - Neither: "no-sync" (set up sync first).
 */
export async function unlockJournal(db: HubDB, passphrase: string): Promise<UnlockResult> {
  if (!passphrase) return "wrong";
  const verifier = await db.journal.get(VERIFIER_ID);
  if (verifier) {
    let m: { jk: JournalKey; s: Uint8Array } | undefined = await fromPassphrase(passphrase);
    if (!(await verifierAccepts(m.jk, verifier))) {
      m.s.fill(0);
      const kek = await deriveKeyWrapKey(passphrase);
      m = await openWrap(db, kek.key, kek.fp);
      if (m && !(await verifierAccepts(m.jk, verifier))) m = (m.s.fill(0), undefined);
    }
    if (!m) return "wrong";
    try {
      await storeCandidate(db, m, null);
    } finally {
      m.s.fill(0);
    }
    return (await confirmJournalKey(db)) === "confirmed" ? "ok" : "wrong";
  }
  const token = await meta<string>(db, "token");
  if (typeof token !== "string" || !token) return "no-sync";
  const typed = await deriveToken(passphrase);
  if (typed !== token) return (await meta<string>(db, ACCEPTED_TOKEN_META)) === token ? "wrong" : "sync-unconfirmed";
  const m = await fromPassphrase(passphrase);
  try {
    if (!(await storeCandidate(db, m, typed))) return "wrong";
  } finally {
    m.s.fill(0);
  }
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
    if (row.kind === KEYWRAP_KIND) continue; // sealed with a KEK, never a journal key
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
