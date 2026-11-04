// This device's reminder settings. Kept in syncMeta (this device only: never synced, never in
// a backup), because each device shows its own notifications.

import { db } from "../data/db";
import { normalizeReminderSettings, type ReminderSettings } from "./schedule";

export const REMINDER_SETTINGS_KEY = "reminders";

/** Sent on window when this device's reminder settings were saved (the scheduler listens). */
export const REMINDERS_CHANGED_EVENT = "esmeworld:reminders-changed";

export async function loadReminderSettings(): Promise<ReminderSettings> {
  const row = await db.syncMeta.get(REMINDER_SETTINGS_KEY);
  return normalizeReminderSettings(row?.value);
}

export async function saveReminderSettings(s: ReminderSettings): Promise<void> {
  await db.syncMeta.put({ key: REMINDER_SETTINGS_KEY, value: normalizeReminderSettings(s) });
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REMINDERS_CHANGED_EVENT));
}
