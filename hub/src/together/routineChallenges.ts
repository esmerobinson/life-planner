// The daily log in Together (Esme's routine plan, 16 Nov 2026): each question is its own
// challenge, "Stuck to daily schedule" and "Finished today's to-dos", and each day she logged
// goes in as one challenge day: "Yes", "Partly" or "No", and her note on the next line.
//
// Together's answer (Oliver's agent, 16 Nov 2026): her login may make the two challenges (in her
// couple, not yet accepted), with the ids below. Their challenge_days are INSERT ONLY: no update
// and no deleted_at. So a day goes once, and only when it is final; nothing here ever edits or
// hides one afterwards:
// - final: her day ended (03:00 the next morning) and ANSWERS_DELAY_MS more has passed, so she has
//   had a whole day to change it; never while answers are held after a Replace;
// - she pressed Done on it, and the question has an answer;
// - never a private day (either tick, Mental health exercise or Daily check-in; a tick that won't
//   open counts as private), and never a day with a version she hasn't settled (another device's
//   answers still listed) or a row that won't open here;
// - only on "Send now" (an automatic run only ever takes words out, which these can't).
//
// Every row's id is fixed by the day, so an insert cut off and tried again is a conflict (23505),
// never a second row. A day she logged by hand in Together is the same conflict: left as it is.
// Behind SEND_ROUTINE_CHALLENGES (SendEnv.routineChallenges in tests).

import { readSharePrivate, type DayLogFields, type FormDay } from "../data/repo";
import { todayISO } from "../domain/dates";
import type { ISODate } from "../domain/types";
import type { JournalKey } from "../journal/crypto";
import type { Choice } from "../journal/routine";
import type { CallResult } from "./client";
import type { TogetherAuth, TogetherSent } from "./store";

/** The switch for this whole step. */
export const SEND_ROUTINE_CHALLENGES = true;

export type RoutineKey = "schedule" | "todos";
export const ROUTINE_KEYS: RoutineKey[] = ["schedule", "todos"];

/** The two challenges in Together: ids from Oliver's answer, names from Esme's plan (PROVISIONAL). */
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
 * Pure: whether the day may go at all is decided by the caller.
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
const duplicate = (r: CallResult) => r.kind === "refused" && (r.code === "23505" || r.status === 409);

/** The challenge is there (found, or made now). false: refused (set aside; its days wait). */
async function ensureChallenge(ctx: RoutineCtx, key: RoutineKey, start: ISODate): Promise<boolean> {
  const made = (ctx.sent.routineChallenges ??= {});
  if (made[key]) return true;
  const { id, name } = ROUTINE_CHALLENGES[key];
  const found = await ctx.call("GET", `challenges?couple_id=eq.${enc(ctx.auth.coupleId)}&id=eq.${enc(id)}&select=id`, undefined, "");
  let ok = found.kind === "ok" && Array.isArray(found.body) && found.body.length > 0;
  if (!ok) {
    const r = await ctx.call("POST", "challenges", { id, couple_id: ctx.auth.coupleId, name, start });
    ok = r.kind === "ok" || duplicate(r);
  }
  if (ok) {
    made[key] = true;
    delete ctx.sent.refused[`routine-challenge:${key}`];
  } else ctx.sent.refused[`routine-challenge:${key}`] = { hash: key, what: "copy" };
  await ctx.save();
  return ok;
}

/**
 * The step itself ("Send now" only): every final, done, not-private day's answers, each inserted
 * once. `logs`: her daily logs (listDayLogs). `delayMs`: the wait after her day ends.
 */
export async function sendRoutineChallenges(
  ctx: RoutineCtx, logs: ({ date: ISODate } & FormDay<DayLogFields>)[], delayMs: number,
  opts: { maxWrites: number; between: () => Promise<void> },
): Promise<void> {
  if (!ctx.jk || ctx.restoredUnpulled) return;
  const record = (ctx.sent.routine ??= {});
  const due: RoutineDayPayload[] = [];
  for (const log of [...logs].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!log.done || log.unreadable > 0 || log.others.length > 0) continue;
    if (!isFinal(log.date, ctx.now(), delayMs)) continue;
    const ticks = await readSharePrivate(ctx.jk, log.date);
    if (ticks.exercise || ticks.checkin) continue;
    for (const p of routineDayPayloads(log.date, log.fields, ctx.auth.coupleId)) {
      if (record[`${p.key}:${p.date}`] !== "sent" && !ctx.sent.refused[`routine:${p.key}:${p.date}`]) due.push(p);
    }
  }
  if (due.length === 0) return;
  const ready = new Map<RoutineKey, boolean>();
  for (const p of due) {
    if (!ready.has(p.key)) ready.set(p.key, await ensureChallenge(ctx, p.key, due.find((d) => d.key === p.key)!.date));
    if (!ready.get(p.key)) continue;
    if (ctx.writes >= opts.maxWrites) {
      await ctx.save();
      await opts.between();
      ctx.writes = 0;
    }
    // Written down before it goes: if this is cut off, it may be in Together (tried again: a conflict).
    const k = `${p.key}:${p.date}`;
    record[k] = "maybe";
    await ctx.save();
    ctx.writes++;
    const r = await ctx.call("POST", "challenge_days", p.body);
    if (r.kind === "ok" || duplicate(r)) record[k] = "sent"; // there now (ours, or one she logged by hand)
    else {
      delete record[k]; // refused: it never went in
      ctx.sent.refused[`routine:${k}`] = { hash: k, what: "copy" };
    }
    await ctx.save();
  }
}
