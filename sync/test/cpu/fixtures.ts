// Fixtures for the CPU measurements (test/cpu): a Due state and a to-do list as large as a
// year of use, with ids that DO match the days searched (re-review R-I1).

import { DEFAULT_DUE_PREFS, type DuePrefs } from "../../src/due/prefs";
import type { DueItem } from "../../src/due/rules";

export interface Case {
  name: string;
  /** Her "now" (her day is the middle of `days`). */
  now: number;
  /** The days searched: yesterday, today, tomorrow ("yyyymmdd"). */
  days: string[];
  /** Reminder objects with a nested object (and a brace in a string) before "id". */
  nested: boolean;
}

export const CASES: Case[] = [
  { name: "mid-month", now: Date.parse("2026-11-16T12:45:00-05:00"), days: ["20261115", "20261116", "20261117"], nested: false },
  { name: "month-end", now: Date.parse("2026-11-30T12:45:00-05:00"), days: ["20261129", "20261130", "20261201"], nested: false },
  { name: "year-end", now: Date.parse("2026-12-31T12:45:00-05:00"), days: ["20261230", "20261231", "20270101"], nested: false },
  { name: "nested", now: Date.parse("2026-12-31T12:45:00-05:00"), days: ["20261230", "20261231", "20270101"], nested: true },
];

/** How many of the searched days' reminders are in the state (most cancelled versions); real use is about 30-40 a day. */
export const MATCHING_PER_DAY = 100;
/** How many are active and ours (what a run really works on). */
export const ACTIVE_PER_DAY = 30;

const pad = (n: number, w: number) => String(n).padStart(w, "0");

/**
 * About a year of Due: 10,000 earlier reminders of ours (all on days next to the searched ones,
 * so they share the needle's start), 2,000 of other apps, and MATCHING_PER_DAY for each searched day.
 */
export function bigState(c: Case): string {
  const reminders: unknown[] = [];
  const near = (i: number) => {
    // Days around the searched ones, never one of them: same month and year as far as possible.
    const d = c.days[1]!;
    const y = d.slice(0, 4);
    const m = d.slice(4, 6);
    const day = 1 + (i % 28);
    const token = `${y}${m}${pad(day, 2)}`;
    return c.days.includes(token) ? `${y}${m}${pad(((day + 5) % 28) + 1, 2)}` : token;
  };
  const shape = (id: string, deleted: boolean, extra: Record<string, unknown> = {}) =>
    c.nested
      ? { meta: { source: { app: "due", v: 2 } }, title: "Has {braces} and \"quotes\"", id, type: "esmeworld", dueAt: "2026-06-01T11:00:00", completedAt: null, deletedAt: deleted ? "2026-06-02T08:00:00.000Z" : null, ...extra }
      : { id, title: "A pretend to-do title", dueAt: "2026-06-01T11:00:00", notes: "From Esmeworld", type: "esmeworld", completedAt: null, deletedAt: deleted ? "2026-06-02T08:00:00.000Z" : null, createdAt: "2026-06-01T08:00:00.000Z", ...extra };
  for (let i = 0; i < 10_000; i++) {
    reminders.push(shape(`esmeworld-${near(i)}-d1-0190a1b2-c3d4-7e5f-8a9b-${pad(i, 12)}-v0000abcd`, true));
    if (i % 5 === 0) reminders.push({ id: `oliver-${i}`, title: "Not ours", type: "manual", dueAt: "2026-06-01T11:00:00", completedAt: null, deletedAt: null });
  }
  for (const day of c.days) {
    for (let j = 0; j < MATCHING_PER_DAY; j++) {
      const active = j < ACTIVE_PER_DAY;
      reminders.splice((j * 37) % reminders.length, 0, shape(`esmeworld-${day}-d1-item${j}-v${pad(j, 8)}`, !active));
    }
  }
  return JSON.stringify({ state: { reminders, version: 3 } });
}

/** 5,000 open to-dos (the cron's SQL hands the rules at most 1,500). */
export function bigItems(n = 5000): DueItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `0190a1b2-c3d4-7e5f-8a9b-${pad(i, 12)}`,
    title: `A pretend to-do title number ${i}`,
    kind: "task",
    status: "open",
    areaId: "admin",
    priority: 1 + (i % 3),
    due: i % 2 ? "2026-12-31" : "2026-11-10",
    ...(i % 7 === 0 ? { recur: ["mon", "thu"] } : {}),
    ...(i % 50 === 0 ? { time: `1${i % 10}:30` } : {}),
  }));
}

export const PREFS: DuePrefs = { ...DEFAULT_DUE_PREFS, on: true, lines: ["One", "Two"] };
