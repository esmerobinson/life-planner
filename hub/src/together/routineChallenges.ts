// The daily log in Together (Esme's routine plan, 16 Nov 2026): each question is its own
// challenge, "Stuck to daily schedule" and "Finished today's to-dos", and each day she logged
// goes in as one challenge day: "Yes", "Partly" or "No" (every answer, honestly: Esme, 16 Nov),
// and her note on the next line.
//
// Together's answer (Oliver's agent, 16 Nov 2026): the challenges are `esme-daily-schedule` and
// `esme-daily-todos`. Their challenge_days are INSERT ONLY: no update and no deleted_at. So:
// - The link NEVER makes the challenges (review C2: once made, their kind and who they are for
//   can't be changed). Oliver makes them. A day goes only into a challenge that is there, is
//   Esme's (`for_user`) and is accepted; otherwise nothing goes and the box says why.
// - A day goes once, and only when it is final: her day ended (03:00 the next morning) and
//   ANSWERS_DELAY_MS more has passed (until then yesterday's log can still be changed on the
//   Daily check-in tab). Never while answers are held after a Replace. Only on "Send now".
// - Only with Done, only answered questions, never a private day (either tick; a tick that won't
//   open counts as private), never a day with another version not settled or a row that won't
//   open. Everything is read again right before each insert (review I1).
// - Every row's id is fixed by the day. Only a true duplicate (that same id already there, checked)
//   counts as sent; the same day logged by hand in Together is left as she wrote it. Any other
//   refusal (a 409 for a missing challenge too, review I2) is never counted as sent: tried again
//   on the next press.
// Behind SEND_ROUTINE_CHALLENGES (off; SendEnv.routineChallenges in tests).

import { readDayLog, readSharePrivate, type DayLogFields, type FormDay } from "../data/repo";
import { todayISO } from "../domain/dates";
import type { ISODate } from "../domain/types";
import type { JournalKey } from "../journal/crypto";
import type { Choice } from "../journal/routine";
import type { CallResult } from "./client";
import type { TogetherAuth, TogetherSent } from "./store";

/** The switch for this whole step: OFF until Oliver has made the challenges and Esme has approved the wording. */
export const SEND_ROUTINE_CHALLENGES = { on: false };

export type RoutineKey = "schedule" | "todos";
export const ROUTINE_KEYS: RoutineKey[] = ["schedule", "todos"];

/** The two challenges in Together: ids from Oliver's answer, names from Esme's plan (PROVISIONAL; Oliver makes them). */
export const ROUTINE_CHALLENGES: Record<RoutineKey, { id: string; name: string }> = {
  schedule: { id: "esme-daily-schedule", name: "Stuck to daily schedule" },
  todos: { id: "esme-daily-todos", name: "Finished today's to-dos" },
};

/** A challenge day's fixed id ("esme-schedule-2026-11-16"). */
export const routineDayId = (key: RoutineKey, date: ISODate): string => `esme-${key}-${date}`;

/** The answer's word in the note (its first line: Together's list shows only that). */
export const CHOICE_WORD: Record<Choice, string> = { yes: "Yes", partly: "Partly", no: "No" };

/** One challenge day, as it would go (the body is exactly what is inserted). */
export interface RoutineDayPayload {
  key: RoutineKey;
  date: ISODate;
  body: { id: string; couple_id: string; challenge_id: string; day: ISODate; note: string };
}

/**
 * The seam: one day's log as the challenge days it makes (none for a question not answered).
 * Pure: whether the day may go at all is routineDayHold's.
 */
export function routineDayPayloads(date: ISODate, log: DayLogFields, coupleId: string): RoutineDayPayload[] {
  const out: RoutineDayPayload[] = [];
  for (const key of ROUTINE_KEYS) {
    const choice = key === "schedule" ? log.schedule : log.todos;
    if (!choice) continue;
    const note = (key === "schedule" ? log.scheduleNote : log.todosNote).trim();
    out.push({
      key,
      date,
      body: {
        id: routineDayId(key, date),
        couple_id: coupleId,
        challenge_id: ROUTINE_CHALLENGES[key].id,
        day: date,
        note: note ? `${CHOICE_WORD[choice]}\n${note}` : CHOICE_WORD[choice],
      },
    });
  }
  return out;
}

/** Her day `date` is final at `now`: it ended (3am) and `delayMs` more has passed. */
export const isFinal = (date: ISODate, now: number, delayMs: number): boolean => todayISO(new Date(now - delayMs)) > date;

/** Why a day's log won't go (yet), or null when it may. In the order she'd fix them. */
export type RoutineHold = "not-done" | "versions" | "unreadable" | "private" | "not-final";

export function routineDayHold(
  log: FormDay<DayLogFields>, ticks: { exercise: boolean; checkin: boolean }, final: boolean,
): RoutineHold | null {
  if (log.unreadable > 0) return "unreadable";
  if (log.others.length > 0) return "versions";
  if (!log.done) return "not-done";
  if (ticks.exercise || ticks.checkin) return "private";
  if (!final) return "not-final";
  return null;
}

/** What the step needs from the sender's run. */
export interface RoutineCtx {
  sent: TogetherSent;
  auth: Required<TogetherAuth>;
  jk: JournalKey | null;
  restoredUnpulled: boolean;
  writes: number;
  now(): number;
  save(): Promise<void>;
  call(method: "GET" | "POST" | "PATCH", path: string, body: unknown, prefer?: string): Promise<CallResult & { kind: "ok" | "refused" }>;
}

const enc = encodeURIComponent;

/** Why a challenge isn't ready for her days ("missing", not hers, not accepted), or null when it is. */
type ChallengeState = null | "missing" | "not-hers" | "not-accepted";

/** Looked up afresh on every press (never trusted from an earlier one, review M3). */
async function challengeState(ctx: RoutineCtx, key: RoutineKey): Promise<ChallengeState> {
  const { id } = ROUTINE_CHALLENGES[key];
  const r = await ctx.call("GET", `challenges?couple_id=eq.${enc(ctx.auth.coupleId)}&id=eq.${enc(id)}&select=id,for_user,accepted_at`, undefined, "");
  const row = r.kind === "ok" && Array.isArray(r.body) ? (r.body[0] as { for_user?: unknown; accepted_at?: unknown } | undefined) : undefined;
  if (!row) return "missing";
  if (row.for_user !== ctx.auth.userId) return "not-hers";
  if (!row.accepted_at) return "not-accepted";
  return null;
}

/** Our row with this id is in Together (a true duplicate, review I2). */
async function oursThere(ctx: RoutineCtx, id: string): Promise<boolean> {
  const r = await ctx.call("GET", `challenge_days?couple_id=eq.${enc(ctx.auth.coupleId)}&id=eq.${enc(id)}&select=id`, undefined, "");
  return r.kind === "ok" && Array.isArray(r.body) && r.body.length > 0;
}

const samePayload = (a: RoutineDayPayload["body"], b: RoutineDayPayload["body"] | undefined) => !!b && JSON.stringify(a) === JSON.stringify(b);

/**
 * The step itself ("Send now" only): every final, done, settled, not-private day's answers, each
 * inserted once. `logs`: her daily logs (listDayLogs). `delayMs`: the wait after her day ends.
 */
export async function sendRoutineChallenges(
  ctx: RoutineCtx, logs: ({ date: ISODate } & FormDay<DayLogFields>)[], delayMs: number,
  opts: { maxWrites: number; between: () => Promise<void> },
): Promise<void> {
  const jk = ctx.jk;
  if (!jk || ctx.restoredUnpulled) return;
  const record = (ctx.sent.routine ??= {});
  const held: { versions?: number; unreadable?: number } = {};
  const due: RoutineDayPayload[] = [];
  for (const log of [...logs].sort((a, b) => a.date.localeCompare(b.date))) {
    const payloads = routineDayPayloads(log.date, log.fields, ctx.auth.coupleId).filter((p) => !["sent", "hand"].includes(record[`${p.key}:${p.date}`] ?? ""));
    if (payloads.length === 0 && log.done) continue; // already in Together (or nothing answered)
    const hold = routineDayHold(log, await readSharePrivate(jk, log.date), isFinal(log.date, ctx.now(), delayMs));
    if (hold) {
      // Counted for the box only when she can settle it there: two versions, or a row that won't open.
      if (hold === "versions" || hold === "unreadable") held[hold] = (held[hold] ?? 0) + 1;
      continue;
    }
    due.push(...payloads);
  }
  ctx.sent.routineHeld = held;
  ctx.sent.routineProblems = 0;
  const states = new Map<RoutineKey, ChallengeState>();
  for (const p of due) {
    if (!states.has(p.key)) states.set(p.key, await challengeState(ctx, p.key));
  }
  const waiting = [...states.values()].find((s) => s !== null);
  if (waiting) ctx.sent.routineWaiting = waiting;
  else delete ctx.sent.routineWaiting;
  await ctx.save();

  for (const p of due) {
    if (states.get(p.key) !== null) continue; // its challenge isn't ready: the box says so
    if (ctx.writes >= opts.maxWrites) {
      await ctx.save();
      await opts.between();
      ctx.writes = 0;
    }
    const k = `${p.key}:${p.date}`;
    // Read again right before the insert (review I1): a tick, an edit or another device's version
    // that arrived while this press went on stops it. These inserts can never be undone.
    const ticks = await readSharePrivate(jk, p.date);
    const now = await readDayLog(jk, p.date);
    const again = routineDayHold(now, ticks, isFinal(p.date, ctx.now(), delayMs));
    if (again || !samePayload(p.body, routineDayPayloads(p.date, now.fields, ctx.auth.coupleId).find((x) => x.key === p.key)?.body)) continue;
    // Written down before it goes: if this is cut off, it may be in Together (tried again: a conflict).
    record[k] = "maybe";
    await ctx.save();
    ctx.writes++;
    const r = await ctx.call("POST", "challenge_days", p.body);
    if (r.kind === "ok") record[k] = "sent";
    else if (r.code === "23505") {
      // Only a true duplicate is "already there": our own id (else: that day logged by hand in
      // Together, left exactly as she wrote it and never tried again).
      record[k] = (await oursThere(ctx, p.body.id)) ? "sent" : "hand";
    } else {
      // Anything else (a missing challenge's 409 too): never counted as sent; tried again next press.
      if (record[k] === "maybe") delete record[k];
      ctx.sent.routineProblems = (ctx.sent.routineProblems ?? 0) + 1;
    }
    await ctx.save();
  }
}
