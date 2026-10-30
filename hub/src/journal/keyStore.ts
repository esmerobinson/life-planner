// Where this device keeps the journal key, and the two ways it gets there (journal brief §3):
// the Sync page's Save (the passphrase she just typed) and the Journal's "Unlock journal".
//
// The key is a NON-extractable CryptoKey stored as an object in syncMeta (IndexedDB holds
// CryptoKeys natively; syncMeta is never synced and never in a backup). The passphrase is
// never stored or logged; callers drop it as soon as these functions return.

import type { HubDB } from "../data/db";
import { deriveToken } from "../sync/token";
import { deriveJournalKey, fileAad, journalAad, openBytes } from "./crypto";

/** syncMeta key of the stored journal key. */
export const JOURNAL_KEY_META = "journalKey";

/**
 * The stored value: the key, and the sync token version it was checked against (null when
 * it was checked against existing journal entries instead). If the sync server later refuses
 * THAT token (a mistyped passphrase), the sync engine forgets this key too.
 */
export interface StoredJournalKey {
  key: CryptoKey;
  tokenVersion: number | null;
}

/** The journal key on this device, or undefined (the Journal then shows "Unlock journal"). */
export async function loadJournalKey(db: HubDB): Promise<CryptoKey | undefined> {
  const value = (await db.syncMeta.get(JOURNAL_KEY_META))?.value as StoredJournalKey | undefined;
  return value && typeof value === "object" && value.key ? value.key : undefined;
}

async function store(db: HubDB, key: CryptoKey, tokenVersion: number | null): Promise<void> {
  const value: StoredJournalKey = { key, tokenVersion };
  await db.syncMeta.put({ key: JOURNAL_KEY_META, value });
}

async function currentTokenVersion(db: HubDB): Promise<number | null> {
  const v = (await db.syncMeta.get("tokenVersion"))?.value;
  return typeof v === "number" ? v : null;
}

/**
 * Sync page Save: the passphrase was just turned into the sync token and saved. The journal
 * key is made from the same passphrase and stored, tied to that token's version.
 */
export async function saveJournalKeyFromSync(db: HubDB, passphrase: string): Promise<void> {
  const key = await deriveJournalKey(passphrase);
  await store(db, key, await currentTokenVersion(db));
}

export type UnlockResult = "ok" | "wrong" | "no-sync";

/**
 * "Unlock journal": checks the typed passphrase before any key is kept, so a typo can never
 * make a second key that writes entries no other device can open.
 * - With a sync token on this device: the passphrase must give exactly that token.
 * - Without one: it must open at least one journal entry (or photo) already here.
 * - Without either there is nothing to check against: "no-sync" (set up sync first).
 */
export async function unlockJournal(db: HubDB, passphrase: string): Promise<UnlockResult> {
  if (!passphrase) return "wrong";
  const token = (await db.syncMeta.get("token"))?.value;
  if (typeof token === "string" && token) {
    if ((await deriveToken(passphrase)) !== token) return "wrong";
    await store(db, await deriveJournalKey(passphrase), await currentTokenVersion(db));
    return "ok";
  }
  const rows = await db.journal.toArray();
  const photos = await db.files.filter((f) => f.encrypted === true).toArray();
  if (rows.length === 0 && photos.length === 0) return "no-sync";
  const key = await deriveJournalKey(passphrase);
  const opens = async (sealed: { iv: string; ct: string }, aad: string) => {
    try {
      await openBytes(key, sealed, aad);
      return true;
    } catch {
      return false;
    }
  };
  for (const r of rows) {
    if (await opens(r, journalAad(r.id))) {
      await store(db, key, null);
      return "ok";
    }
  }
  for (const f of photos) {
    if (await opens({ iv: f.iv!, ct: f.data }, fileAad(f.id))) {
      await store(db, key, null);
      return "ok";
    }
  }
  return "wrong";
}
