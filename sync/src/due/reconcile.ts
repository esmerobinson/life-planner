// The diff: what Esme wants now (rules.ts) against what Due holds, then the fewest calls to
// make Due match. Replaying a run against the same state makes no calls (idempotent).
//
// - Ours are the reminders with type "esmeworld" and an id starting "esmeworld-".
// - Wanted and missing: created, only if it hasn't gone off yet (Due drops past-due reminders
//   and never alerts late, so a late one would be noise at best).
// - Wanted and active in Due but different (title or time): replaced (DELETE, then POST), again
//   only if it hasn't gone off yet.
// - Wanted but completed or deleted in Due: left alone. She ticked or dismissed it there (or
//   it was cancelled when its to-do was done); it is never brought back the same day.
// - Active in Due but no longer wanted (done, moved, yesterday's, Due turned off): cancelled.
// - A POST that says "already exists" (Due's state was stale): DELETE, then POST again.
// Cancels go first (they are what "done means cancelled" needs), then creates, soonest first.
// The run never goes over the client's call budget; what is left waits for the next run.

import { DueStop, REMINDER_TYPE, type DueClient, type DueRemote, type NewReminder } from "./client";
import type { Wanted } from "./rules";
import { isoInZone, parseDueAt } from "./time";

export const NOTES = "From Esmeworld";
const MINUTE = 60_000;

export interface Plan {
  cancel: string[];
  create: Wanted[];
  replace: Wanted[];
}

export interface RunReport extends Plan {
  done: { cancelled: number; created: number; replaced: number; rejected: number };
  stopped?: DueStop["code"];
}

const isNullish = (v: unknown) => v === null || v === undefined;
const isOurs = (r: DueRemote) => r.type === REMINDER_TYPE && r.id.startsWith("esmeworld-");
const isActive = (r: DueRemote) => isNullish(r.completedAt) && isNullish(r.deletedAt);
const sameMinute = (a: number, b: number) => Math.floor(a / MINUTE) === Math.floor(b / MINUTE);

/** The calls needed, worked out without making any. Pure. */
export function planCalls(wanted: readonly Wanted[], remote: readonly DueRemote[], now: number): Plan {
  const mine = new Map<string, DueRemote>();
  for (const r of remote) {
    if (!isOurs(r)) continue;
    // Several copies of one id (an old cancelled one and a live one): the live one counts.
    const had = mine.get(r.id);
    if (!had || isActive(r)) mine.set(r.id, r);
  }
  const wantedIds = new Set(wanted.map((w) => w.id));
  const cancel = [...mine.values()].filter((r) => isActive(r) && !wantedIds.has(r.id)).map((r) => r.id).sort();
  const create: Wanted[] = [];
  const replace: Wanted[] = [];
  for (const w of [...wanted].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))) {
    if (w.at <= now) continue; // gone off already: Due would drop it
    const have = mine.get(w.id);
    if (!have) create.push(w);
    else if (isActive(have) && !(have.title === w.title && sameMinute(parseDueAt(have.dueAt), w.at))) replace.push(w);
  }
  return { cancel, create, replace };
}

const body = (w: Wanted, timeZone: string): NewReminder => ({
  id: w.id,
  title: w.title,
  dueAt: isoInZone(w.at, timeZone),
  notes: NOTES,
  type: REMINDER_TYPE,
});

/** One whole pass: read Due, plan, make the calls. Never throws; stops early only as the report says. */
export async function reconcile(client: DueClient, wanted: readonly Wanted[], timeZone: string, now: number): Promise<RunReport> {
  const done = { cancelled: 0, created: 0, replaced: 0, rejected: 0 };
  let plan: Plan = { cancel: [], create: [], replace: [] };
  try {
    plan = planCalls(wanted, await client.state(), now);
    for (const id of plan.cancel) {
      if (client.remaining < 1) throw new DueStop("budget");
      if ((await client.cancel(id)) === "ok") done.cancelled++;
      else done.rejected++;
    }
    const writes = [...plan.replace.map((w) => ({ w, replace: true })), ...plan.create.map((w) => ({ w, replace: false }))]
      .sort((a, b) => a.w.at - b.w.at);
    for (const { w, replace } of writes) {
      // Room for the worst case (POST, "exists", DELETE, POST), so a reminder is never left half-replaced.
      if (client.remaining < 3) throw new DueStop("budget");
      if (replace) await client.cancel(w.id);
      let result = await client.create(body(w, timeZone));
      if (result === "exists") {
        await client.cancel(w.id);
        result = await client.create(body(w, timeZone));
      }
      if (result === "ok") done[replace ? "replaced" : "created"]++;
      else done.rejected++;
    }
    return { ...plan, done };
  } catch (error) {
    if (error instanceof DueStop) return { ...plan, done, stopped: error.code };
    return { ...plan, done, stopped: "due_unreachable" };
  }
}
