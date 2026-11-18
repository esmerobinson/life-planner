// The diff: what Esme wants now (rules.ts) against what Due holds, then the fewest calls to
// make Due match. Replaying a run against the same state makes no calls (idempotent).
//
// Ids are never reused (review I1). A reminder's id is its key (what, which day: rules.ts) plus
// a version, a hash of its title and time: `<key>-v<8 hex>`, and `g2`, `g3`… when the same
// version has to be made again. So:
// - Wanted, and that exact version is active in Due: nothing to do. (Compared by our own id,
//   never by Due's echo of the title or time, so a different format there causes no churn.)
// - Wanted, and changed (title or time): the new version is created, then the old one cancelled.
// - Wanted but gone: made again under the next `g` id, if Esmeworld itself cancelled it (the
//   cron keeps a log of every id it cancels, written BEFORE the DELETE). If SHE completed or
//   deleted any version of it in Due, it is left alone for that day: she dismissed it.
// - Due's list might leave out completed and deleted reminders (its filtered endpoint, 18 Nov:
//   not confirmed either way). So the cron also logs every id it sent and when it goes off
//   (written AFTER the POST). A version we sent whose time hasn't come, that Due no longer
//   lists and that we didn't cancel, was dismissed by her: left alone too. And the next `g` id
//   skips every id we ever sent or cancelled, listed or not, so an id is never sent twice.
// - Active in Due but no longer wanted (done, moved, yesterday's, Due turned off): cancelled.
// - Never sent if its time has passed (Due drops those): an active older version is kept.
// - At most MAX_CANCELS_PER_KEY of our own cancellations per reminder per day; after that it is
//   left as it is (no flapping).
// - A POST answered "already exists" means that exact version is there: nothing more to do.
// The run stops after MAX_REJECTIONS refusals, and never goes over the client's budget or deadline.

import { DueStop, REMINDER_TYPE, type DueClient, type DueRemote, type NewReminder } from "./client";
import type { Wanted } from "./rules";
import { DUE_DEFAULT_ZONE, isoInZone, wallClock } from "./time";

export const NOTES = "From Esmeworld";
/** After this many of our own cancellations of one reminder in a day, it is left alone. */
export const MAX_CANCELS_PER_KEY = 3;
/** Refusals from Due (4xx) in one run before it stops. */
export const MAX_REJECTIONS = 3;
const VERSION = /-v[0-9a-f]{8}(?:g\d+)?$/;

/**
 * The ids Esmeworld itself cancelled (so "deleted" in Due doesn't mean she dismissed it), and
 * the ids it sent, with when each goes off (so one Due stops listing is known to be dismissed).
 */
export interface CancelLog {
  cancelled: ReadonlySet<string>;
  sent: ReadonlyMap<string, number>;
  /** Called BEFORE the DELETEs are sent, so a run cut short still knows they were ours. */
  record(ids: readonly string[]): Promise<void>;
  /** Called AFTER the POSTs, with only those Due took (or already had). */
  recordSent(sent: readonly { id: string; at: number }[]): Promise<void>;
}

export interface Create {
  id: string;
  key: string;
  title: string;
  /** When it goes off. */
  at: number;
  /** Its older versions, cancelled once it is in. */
  replaces: string[];
}

export interface Plan {
  /** Active, and no longer wanted at all. */
  cancel: string[];
  create: Create[];
  /** Other active versions of reminders whose current version is already in. */
  replaced: string[];
}

export interface RunReport extends Plan {
  done: { cancelled: number; created: number; rejected: number };
  stopped?: DueStop["code"];
  /** The HTTP status behind the stop, when there was one. */
  stoppedStatus?: number;
  /** An unreadable answer's shape (key names and types only): safe to log. */
  stoppedShape?: string;
}

const isNullish = (v: unknown) => v === null || v === undefined;
const isOurs = (r: DueRemote) => r.type === REMINDER_TYPE && r.id.startsWith("esmeworld-");
const isActive = (r: DueRemote) => isNullish(r.completedAt) && isNullish(r.deletedAt);
export const keyOf = (id: string) => id.replace(VERSION, "");

/** FNV-1a, 32-bit, 8 hex digits. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The version id of a wanted reminder (generation 1). */
export const versionId = (w: Wanted) => `${w.key}-v${fnv(`${w.title}\u0000${w.at}`)}`;
const generation = (base: string, g: number) => (g === 1 ? base : `${base}g${g}`);

function push<T>(m: Map<string, T[]>, k: string, v: T): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

/** The calls needed, worked out without making any. Pure. */
export function planCalls(
  wanted: readonly Wanted[],
  remote: readonly DueRemote[],
  cancelledByUs: ReadonlySet<string>,
  now: number,
  sentByUs: ReadonlyMap<string, number> = new Map(),
): Plan {
  const byKey = new Map<string, DueRemote[]>();
  for (const r of remote) if (isOurs(r)) push(byKey, keyOf(r.id), r);
  // Every id our logs know, by key: listed by Due or not.
  const logged = new Map<string, string[]>();
  for (const id of cancelledByUs) push(logged, keyOf(id), id);
  for (const id of sentByUs.keys()) if (!cancelledByUs.has(id)) push(logged, keyOf(id), id);
  const wantedKeys = new Set(wanted.map((w) => w.key));
  const cancel: string[] = [];
  for (const [k, recs] of byKey) if (!wantedKeys.has(k)) for (const r of recs) if (isActive(r)) cancel.push(r.id);
  cancel.sort();

  const create: Create[] = [];
  const replaced: string[] = [];
  for (const w of [...wanted].sort((a, b) => (a.sendAt ?? a.at) - (b.sendAt ?? b.at) || (a.key < b.key ? -1 : 1))) {
    const recs = byKey.get(w.key) ?? [];
    const active = recs.filter(isActive);
    // She completed or deleted a version in Due: dismissed for the day.
    if (recs.some((r) => !isActive(r) && (!isNullish(r.completedAt) || !cancelledByUs.has(r.id)))) continue;
    const listed = new Set(recs.map((r) => r.id));
    const mine = logged.get(w.key) ?? [];
    // One we sent, not yet gone off, that Due no longer lists and we didn't cancel: she dismissed it.
    if (mine.some((id) => !listed.has(id) && !cancelledByUs.has(id) && (sentByUs.get(id) ?? 0) > now)) continue;
    const base = versionId(w);
    const here = new Set([...listed, ...mine]);
    const current = active.find((r) => r.id === base || (r.id.startsWith(`${base}g`) && keyOf(r.id) === w.key));
    if (current) {
      // This version is in; any other active version of it goes.
      for (const r of active) if (r !== current) replaced.push(r.id);
      continue;
    }
    const at = w.sendAt ?? w.at;
    if (at <= now) continue; // gone off already: Due would drop it; an older version stays
    if (mine.filter((id) => cancelledByUs.has(id)).length >= MAX_CANCELS_PER_KEY) continue;
    let g = 1;
    while (here.has(generation(base, g))) g++;
    create.push({ id: generation(base, g), key: w.key, title: w.title, at, replaces: active.map((r) => r.id) });
  }
  return { cancel, create, replaced };
}

/** Due's dueAt: her wall clock, with the offset unless she is in Due's own zone (US Eastern). */
export function formatDueAt(ms: number, timeZone: string): string {
  if (timeZone !== DUE_DEFAULT_ZONE) return isoInZone(ms, timeZone);
  const w = wallClock(ms, timeZone);
  return `${w.date}T${w.time}:00`;
}

const body = (c: Create, timeZone: string): NewReminder => ({
  id: c.id,
  title: c.title,
  dueAt: formatDueAt(c.at, timeZone),
  notes: NOTES,
  type: REMINDER_TYPE,
});

export interface ReconcileOptions {
  timeZone: string;
  now: number;
  /** The days ("yyyymmdd") whose reminders are looked at: yesterday, today and tomorrow. */
  days: readonly string[];
  /** Due's list is asked from this moment on (ISO with offset): the start of the first of `days`. */
  from: string;
  log: CancelLog;
}

/** One whole pass: read Due, plan, make the calls. Never throws; stops early only as the report says. */
export async function reconcile(client: DueClient, wanted: readonly Wanted[], opts: ReconcileOptions): Promise<RunReport> {
  const done = { cancelled: 0, created: 0, rejected: 0 };
  let plan: Plan = { cancel: [], create: [], replaced: [] };
  const rejected = () => {
    done.rejected++;
    if (done.rejected >= MAX_REJECTIONS) throw new DueStop("due_rejecting");
  };
  const cancelAll = async (ids: string[]) => {
    if (ids.length === 0) return;
    await opts.log.record(ids);
    for (const id of ids) {
      if ((await client.cancel(id)) === "ok") done.cancelled++;
      else rejected();
    }
  };
  try {
    plan = planCalls(wanted, await client.reminders(opts.days, opts.from), opts.log.cancelled, opts.now, opts.log.sent);
    // What she ticked off goes first ("done means cancelled").
    await cancelAll(plan.cancel);
    const older = [...plan.replaced];
    const sent: { id: string; at: number }[] = [];
    try {
      for (const c of plan.create) {
        const result = await client.create(body(c, opts.timeZone));
        if (result === "rejected") rejected();
        else {
          done.created++; // "exists": that very version is there already
          sent.push({ id: c.id, at: c.at });
          older.push(...c.replaces);
        }
      }
    } finally {
      // Even when the run stops part-way: what Due took is logged.
      if (sent.length) await opts.log.recordSent(sent);
    }
    // Older versions go only once their replacements are in.
    await cancelAll(older);
    return { ...plan, done };
  } catch (error) {
    if (!(error instanceof DueStop)) return { ...plan, done, stopped: "due_unreachable" };
    return {
      ...plan,
      done,
      stopped: error.code,
      ...(error.status ? { stoppedStatus: error.status } : {}),
      ...(error.shape !== undefined ? { stoppedShape: error.shape } : {}),
    };
  }
}
