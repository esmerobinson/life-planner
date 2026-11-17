// The Due reminder settings row (reminders/duePrefs.ts): read and saved through the synced
// `prefs` table, so the sync Worker gets them at the next sync.

import { db } from "../data/db";
import { DUE_PREFS_ID, duePrefsRow, normalizeDuePrefs, type DuePrefs } from "./duePrefs";

export async function loadDuePrefs(): Promise<DuePrefs> {
  return normalizeDuePrefs(await db.prefs.get(DUE_PREFS_ID));
}

export async function saveDuePrefs(p: DuePrefs): Promise<DuePrefs> {
  const row = duePrefsRow(p);
  await db.prefs.put(row);
  const { id: _id, updatedAt: _u, ...saved } = row;
  return saved;
}
