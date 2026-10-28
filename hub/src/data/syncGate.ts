// What restores and imports may do while sync is on, and the lock they share with sync.
//
// - "Sync is on" means this device has a token stored, or had one refused (it is waiting
//   for the passphrase again). "Stop syncing on this device" turns it off.
// - While sync is on, Replace is refused: the server never deletes, so it cannot mean
//   "only what is in the file" any more.
// - While sync is on and this device has not yet finished its first full pull, Merge and the
//   in-app importers are refused: "add what is missing" is only meaningful once this device
//   knows what the server already has.
// - Restores take the same Web Lock as a sync run, so no run is in flight while a restore
//   writes (a run finishing afterwards could otherwise overwrite the restore's cursor reset).

import type Dexie from "dexie";
import type { Table } from "dexie";

/** Placeholder copy (Esme may reword): why Merge and imports are off for now. */
export const WAITING_FIRST_SYNC = "Waiting for the first sync to finish.";
/** Placeholder copy (Esme may reword): why Replace is off. */
export const REPLACE_OFF_WHILE_SYNCING = "Replace is off while sync is on. Merge still works.";

export interface SyncGate {
  syncOn: boolean;
  firstPullDone: boolean;
}

type MetaTable = Table<{ key: string; value: unknown }, string>;

/** Reads the gate (inside the caller's transaction if there is one that includes syncMeta). */
export async function readSyncGate(syncMeta: MetaTable): Promise<SyncGate> {
  const [token, needsPassphrase, firstPullDone] = await Promise.all([
    syncMeta.get("token"),
    syncMeta.get("needsPassphrase"),
    syncMeta.get("firstPullDone"),
  ]);
  return {
    syncOn: Boolean(token?.value) || needsPassphrase?.value === true,
    firstPullDone: firstPullDone?.value === true,
  };
}

export const mergeBlocked = (g: SyncGate) => g.syncOn && !g.firstPullDone;
export const replaceBlocked = (g: SyncGate) => g.syncOn;

/** The Web Lock name shared by sync runs and restores for one database. */
export const syncLockName = (db: Dexie) => `esmeworld-sync:${db.name}`;

/** Runs `fn` holding the sync lock (across tabs where the browser has Web Locks). */
export function withSyncLock<T>(db: Dexie, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks?.request) return locks.request(syncLockName(db), () => fn()) as Promise<T>;
  return fn();
}
