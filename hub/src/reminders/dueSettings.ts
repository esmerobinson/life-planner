// The Due reminder settings row (reminders/duePrefs.ts), read and saved through the synced
// `prefs` table, so the sync Worker gets them at the next sync.
//
// Saves change only the fields she changed, merged into the NEWEST row in one transaction
// (review I5): a page left open on one device never writes its old copy over what another
// device saved since. Fields a later version added are kept.

import { db } from "../data/db";
import { DUE_PREFS_ID, duePrefsRow, normalizeDuePrefs, type DuePrefs, type DuePrefsRow } from "./duePrefs";

export async function loadDuePrefs(): Promise<DuePrefs> {
  return normalizeDuePrefs(await db.prefs.get(DUE_PREFS_ID));
}

/** What the section shows: the row (absent when none yet), and whether it may be edited here. */
export interface DueSettingsView {
  row: DuePrefsRow | undefined;
  /** Sync is set up here but hasn't pulled everything once: her settings may be on their way. */
  waitingForSync: boolean;
}

export async function readDueSettingsView(): Promise<DueSettingsView> {
  const [row, token, firstPull] = await Promise.all([
    db.prefs.get(DUE_PREFS_ID),
    db.syncMeta.get("token"),
    db.syncMeta.get("firstPullDone"),
  ]);
  return { row, waitingForSync: row === undefined && Boolean(token?.value) && firstPull?.value !== true };
}

/** Applies `change` (worked out from the newest settings) and saves the result. */
export async function updateDuePrefs(change: (current: DuePrefs) => Partial<DuePrefs>): Promise<void> {
  await db.transaction("rw", db.prefs, async () => {
    const stored = await db.prefs.get(DUE_PREFS_ID);
    const current = normalizeDuePrefs(stored);
    const next = duePrefsRow({ ...current, ...change(current) });
    const { updatedAt: _stamp, ...kept } = (stored ?? {}) as Partial<DuePrefsRow>;
    await db.prefs.put({ ...kept, ...next });
  });
}
