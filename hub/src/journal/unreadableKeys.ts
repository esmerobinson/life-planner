// Journal keys this device stored but can no longer read (2026-11-02).
//
// WebKit (the Mac app, Safari) wraps every CryptoKey it stores in IndexedDB with a "master
// key". A key stored under another master key (in the Mac app: one stored by a build that
// used the macOS keychain's master key) can't be unwrapped. Reading such a row with `get`
// NEVER ANSWERS in WebKit (it fails with "Cannot inject key into script value" off to the
// side), so every journal read waited forever and the Journal said "Can't open". Read with a
// cursor, `cursor.value` throws that error at once instead, so that is how they are found.
//
// At start-up, before anything else touches the database, each key row is checked that way;
// an unreadable one is removed WITHOUT being read (removing never unwraps it) and, for the
// confirmed key, a plain note is left so the Journal asks for the passphrase once more.
// Nothing is lost: the same passphrase makes exactly the same key again.

import type { HubDB } from "../data/db";

/** The syncMeta rows that hold CryptoKeys (same names as keyStore's constants). */
export const KEY_ROWS = ["journalKey", "journalCandidate", "journalRetired"] as const;
/** syncMeta: `true` when a confirmed key was stored here but couldn't be read and was removed. */
export const JOURNAL_KEY_LOST_META = "journalKeyLost";

/** "unknown": the check failed some other way or took too long, so nothing is changed. */
export type RowCheck = "readable" | "unreadable" | "absent" | "unknown";

/** WebKit's cursor error for a value it can't rebuild (an unwrappable CryptoKey). */
const isUnreadableError = (e: unknown): boolean => {
  const name = (e as { name?: string } | null)?.name ?? "";
  const message = (e as { message?: string } | null)?.message ?? "";
  return name === "DataCloneError" || (name === "UnknownError" && /inject key|deserializ|script value/i.test(message));
};

/** Checks one syncMeta row with a cursor on the raw IndexedDB connection (never `get`). */
export function checkRowRaw(idb: IDBDatabase, key: string): Promise<RowCheck> {
  return new Promise((resolve) => {
    try {
      const req = idb.transaction("syncMeta", "readonly").objectStore("syncMeta").openCursor(key);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve("absent");
        try {
          void cursor.value; // WebKit rebuilds the value here and throws if it can't
          resolve("readable");
        } catch (e) {
          resolve(isUnreadableError(e) ? "unreadable" : "unknown");
        }
      };
      req.onerror = (ev) => {
        ev?.preventDefault?.(); // a handled read error must not abort anything else
        ev?.stopPropagation?.();
        resolve(isUnreadableError(req.error) ? "unreadable" : "unknown");
      };
    } catch (e) {
      resolve(isUnreadableError(e) ? "unreadable" : "unknown");
    }
  });
}

/**
 * Removes the key rows `check` says can't be read; returns their names. A check that doesn't
 * answer within `ms` counts as "unknown" (left alone), so start-up is never held up.
 */
export async function dropUnreadableKeys(
  db: HubDB,
  check: (key: string) => Promise<RowCheck> = (key) => checkRowRaw(db.backendDB(), key),
  ms = 3000,
): Promise<string[]> {
  const found: string[] = [];
  for (const key of KEY_ROWS) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      check(key).catch((): RowCheck => "unknown"),
      new Promise<RowCheck>((r) => (timer = setTimeout(() => r("unknown"), ms))),
    ]);
    clearTimeout(timer);
    if (result === "unreadable") found.push(key);
  }
  if (found.length === 0) return found;
  await db.transaction("rw", db.syncMeta, async () => {
    await db.syncMeta.bulkDelete(found);
    if (found.includes("journalKey")) await db.syncMeta.put({ key: JOURNAL_KEY_LOST_META, value: true });
  });
  return found;
}
