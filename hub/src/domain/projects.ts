// Project to-dos (projects round, mockup add-and-projects.html option 2C, created with 3A).
// A project is a to-do with sessions and a deadline (`due`). Ticking logs a session; it is
// done (completedAt that day) when its last session is ticked, and unticking reopens it.

import { daysBetween } from "./dates";
import { dueLine } from "./display";
import type { ISODate, Item, Session } from "./types";

/** The fewest and most sessions a project has, and how many a new one starts with. */
export const MIN_SESSIONS = 1;
export const MAX_SESSIONS = 20;
export const DEFAULT_SESSIONS = 4;
/** The longest session title and details (characters). */
export const MAX_SESSION_TITLE = 120;
export const MAX_SESSION_DETAILS = 1000;

/** A to-do with sessions. */
export function isProject(it: Item): boolean {
  return it.kind === "task" && (it.sessions?.length ?? 0) > 0;
}

/** `n` unnamed sessions ("Session 1"…), each with its own id. */
export function newSessions(n: number): Session[] {
  return Array.from({ length: n }, () => ({ id: crypto.randomUUID() }));
}

/** A session's title, or "Session 3" by its place (index 2) when unnamed. */
export function sessionName(s: Session, index: number): string {
  return s.title ?? `Session ${index + 1}`;
}

/** Sessions ticked. */
export function doneCount(it: Item): number {
  return (it.sessions ?? []).filter((s) => s.doneOn !== undefined).length;
}

/**
 * The session a tick logs and the strip names: the first not-done one planned for today,
 * else the first not done. -1 when every session is done.
 */
export function nextSessionIndex(it: Item, today: ISODate): number {
  const list = it.sessions ?? [];
  const planned = list.findIndex((s) => s.doneOn === undefined && s.plannedFor === today);
  return planned >= 0 ? planned : list.findIndex((s) => s.doneOn === undefined);
}

/** The last session ticked today (-1 when none was). */
export function doneTodayIndex(it: Item, today: ISODate): number {
  const list = it.sessions ?? [];
  for (let i = list.length - 1; i >= 0; i--) if (list[i].doneOn === today) return i;
  return -1;
}

/** A not-done session is planned for today. */
export function plannedToday(it: Item, today: ISODate): boolean {
  return (it.sessions ?? []).some((s) => s.doneOn === undefined && s.plannedFor === today);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Session 3 of 4" for index 2. */
const ofLabel = (it: Item, i: number) => `Session ${i + 1} of ${it.sessions?.length ?? 0}`;

/**
 * The area strip's small line (2C): "Next: <title>" when the next session is named, else
 * "Session 3 of 4"; and the due line with the days left ("Due Mon 9 Nov · 7 days left").
 */
export function projectLine(it: Item, today: ISODate): { lead: string; due?: string; late?: boolean } {
  const i = nextSessionIndex(it, today);
  const s = i >= 0 ? it.sessions![i] : undefined;
  const lead = s === undefined ? `All ${plural(it.sessions?.length ?? 0, "session")} done` : s.title ? `Next: ${s.title}` : ofLabel(it, i);
  const line = dueLine(it, today);
  if (line.due === undefined) return { lead };
  const n = daysBetween(today, it.due!);
  return { lead, due: n > 1 ? `${line.due} · ${plural(n, "day")} left` : line.due, late: line.late ?? false };
}

/**
 * The Today strip's small line: "Session 3 of 4 today · <title if named>" (once a session is
 * ticked today: "Session 3 of 4 done today · …"), and the plain due line ("Due Mon 9 Nov").
 */
export function todayLine(it: Item, today: ISODate): { lead: string; due?: string; late?: boolean } {
  const doneIdx = doneTodayIndex(it, today);
  const i = doneIdx >= 0 ? doneIdx : nextSessionIndex(it, today);
  const line = dueLine(it, today);
  const due = line.due === undefined ? {} : { due: line.due, late: line.late ?? false };
  if (i < 0) return { lead: `All ${plural(it.sessions?.length ?? 0, "session")} done`, ...due };
  const s = it.sessions![i];
  const lead = `${ofLabel(it, i)} ${doneIdx >= 0 ? "done today" : "today"}${s.title ? ` · ${s.title}` : ""}`;
  return { lead, ...due };
}

/**
 * The countdown edge (2C): the share of the time from making it to the deadline still left
 * (1 = all of it, 0 = the deadline is today or past). Null without a deadline.
 */
export function countdown(it: Item, today: ISODate): number | null {
  if (it.due === undefined) return null;
  const left = daysBetween(today, it.due);
  if (left <= 0) return 0;
  const span = daysBetween(it.createdAt, it.due);
  return span <= 0 ? 1 : Math.min(1, left / span);
}

/**
 * The item with these sessions, done when every one is (completedAt that day, kept when it
 * was already done) and open otherwise (completedAt removed).
 */
export function withSessions(it: Item, sessions: Session[], today: ISODate): Item {
  const { completedAt, ...rest } = it;
  if (sessions.every((s) => s.doneOn !== undefined)) {
    return { ...rest, sessions, status: "done", completedAt: it.status === "done" && completedAt ? completedAt : today };
  }
  return { ...rest, sessions, status: "open" };
}
