// The Mac app's notification bridge (mac/Esmeworld/main.swift, "esmeworldReminders"). The web
// app works out the schedule (schedule.ts); the Mac app only shows it. Anywhere without the
// bridge (a browser, the iPhone home-screen app) every call here is a no-op.

import type { ScheduledReminder } from "./schedule";

export const REMINDERS_HANDLER = "esmeworldReminders";

/** The Mac's answer about notifications for Esmeworld. */
export type NotifyPermission = "authorized" | "denied" | "not-determined" | "unknown";

interface ReplyHandler {
  postMessage(message: unknown): Promise<unknown>;
}

function handler(): ReplyHandler | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { webkit?: { messageHandlers?: Record<string, ReplyHandler | undefined> } };
  return w.webkit?.messageHandlers?.[REMINDERS_HANDLER] ?? null;
}

/** True inside the Mac app (which can show notifications). */
export function hasNativeReminders(): boolean {
  return handler() !== null;
}

function permissionOf(reply: unknown): NotifyPermission {
  const s = typeof reply === "object" && reply !== null ? (reply as { status?: unknown }).status : undefined;
  return s === "authorized" || s === "denied" || s === "not-determined" ? s : "unknown";
}

async function call(message: Record<string, unknown>): Promise<unknown> {
  const h = handler();
  if (!h) return null;
  return h.postMessage(message);
}

/** Whether the Mac lets Esmeworld notify. Never asks. */
export async function notifyPermission(): Promise<NotifyPermission> {
  if (!hasNativeReminders()) return "unknown";
  try {
    return permissionOf(await call({ action: "status" }));
  } catch {
    return "unknown";
  }
}

/** Asks the Mac once (its own prompt; it only ever asks the first time). */
export async function askNotifyPermission(): Promise<NotifyPermission> {
  if (!hasNativeReminders()) return "unknown";
  try {
    return permissionOf(await call({ action: "requestPermission" }));
  } catch {
    return "unknown";
  }
}

/**
 * Hands the Mac the whole schedule; it replaces every pending Esmeworld reminder with it.
 * Only titles, counts and app paths cross. `today` (the app-day) and `keepToday` (today's
 * reminder ids that still stand) let it take done ones out of Notification Center. Returns how
 * many it holds, or null without a bridge.
 */
export async function sendSchedule(
  reminders: readonly ScheduledReminder[],
  delivered?: { today: string; keepToday: readonly string[] },
): Promise<{ scheduled: number; status: NotifyPermission } | null> {
  if (!hasNativeReminders()) return null;
  const reply = await call({
    action: "schedule",
    reminders: reminders.map(({ id, at, title, body, path }) => ({ id, at, title, body, path })),
    ...(delivered ? { today: delivered.today, keepToday: [...delivered.keepToday] } : {}),
  });
  const scheduled = typeof reply === "object" && reply !== null ? Number((reply as { scheduled?: unknown }).scheduled) : NaN;
  return { scheduled: Number.isFinite(scheduled) ? scheduled : 0, status: permissionOf(reply) };
}
