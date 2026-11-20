// The Due reminders run: every 15 minutes from the cron trigger (wrangler.jsonc), and soon
// after a sync that ticks something off or changes a to-do's day or time (index.ts, never
// blocking the sync's answer).
//
// One run: read her settings row and her candidate to-dos/habits from D1 (plain JSON rows),
// work out the reminders she wants now (rules.ts), and make Due match (reconcile.ts).
//
// Safety:
// - Nothing happens at all unless the DUE_TOKEN and DUE_BASE_URL secrets are set.
// - A lease in `meta` lets only one run talk to Due at a time. A run has a deadline
//   (RUN_DEADLINE_MS, inside the 30 s a run after a sync is given) and every call a timeout,
//   so a run always ends well before its lease does: two runs never overlap.
// - At most MAX_CALLS_PER_RUN calls to Due. Due down or refusing stops the run; after repeated
//   refusals Due is left alone for BACKOFF_MS. Runs started by sync: at most one a minute.
// - Turned Off and nothing left in Due: the run doesn't even ask Due.
// - Logs are fixed codes only (never the token, a title or a Due answer), plus, when a run
//   stops, the HTTP status and, for an answer it couldn't read, that answer's top-level shape
//   (key names and types only: client.ts describeShape).
// - D1 keeps, in `meta`, the ids this Worker cancelled (`due_x:<id>`, kept 3 days), so a
//   reminder Esmeworld cancelled is never mistaken for one she dismissed, and the ids it sent
//   (`due_s:<id>`, the value is when it goes off; kept 3 days after), so one she dismissed is
//   known even if Due's list leaves it out (reconcile.ts).
// - Due's list is asked from the start of yesterday in her zone (Oliver's filtered endpoint):
//   every reminder of the three days looked at that can still go off is due after that.

import type { Env } from "../env";
import { DueClient } from "./client";
import { DUE_PREFS_ID, PREFS_TABLE, readDuePrefs } from "./prefs";
import { reconcile, type CancelLog, type RunReport } from "./reconcile";
import { dayToken, wantedReminders, type DueItem, type TodayPicks } from "./rules";
import { addDays, appDay, instantOf, isoInZone, weekdayOf } from "./time";

/** Workers allow 50 subrequests per invocation; this leaves room. */
export const MAX_CALLS_PER_RUN = 40;
/** A run's own deadline: well inside the 30 s a run after a sync gets, and the lease. */
export const RUN_DEADLINE_MS = 20_000;
/** How long one run may hold the lease: longer than any run can take (deadline + one call). */
export const LEASE_MS = 60_000;
/** Sync-started runs: at most one per this long. */
export const SYNC_RUN_GAP_MS = 60_000;
/** After Due refused several calls in a run: leave it alone this long. */
export const BACKOFF_MS = 60 * 60_000;
/**
 * The most candidate to-dos one run reads (CPU, re-review R-I1). Those with a reminder of their
 * own (a time, or Remind me) come first, so the cut never drops one of those (unless she has
 * more than this many); the count then counts at most this many (it says "300 to-dos left" on
 * a day with more, which is still the point).
 */
export const MAX_ITEM_ROWS = 300;
/** The day's kept picks on Today (hub/src/domain/todayFill.ts): at most this many are read. */
const MAX_PICKS = 50;
/** How long the log of our own cancellations is kept. */
const CANCEL_LOG_MS = 3 * 86_400_000;

export interface DueDeps {
  /** "Now" for the rules (tests fix it). */
  now: () => number;
  dueFetch: typeof fetch;
  /** The real clock, for the deadline (defaults to Date.now). */
  clock?: () => number;
}

export type DueRunResult =
  | { kind: "off"; reason: "no_token" | "bad_base_url" }
  | { kind: "busy" }
  | { kind: "skipped"; reason: "gap" | "backoff" | "off_and_clean" }
  | { kind: "ran"; report: RunReport };

const LEASE_SQL = `
INSERT INTO meta (key, value) VALUES ('due_lease', ?1)
ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE meta.value <= ?2
RETURNING value`;
const RELEASE_SQL = "UPDATE meta SET value = 0 WHERE key = 'due_lease' AND value = ?1";
const SYNC_GAP_SQL = `
INSERT INTO meta (key, value) VALUES ('due_sync_run', ?1)
ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE meta.value <= ?2
RETURNING value`;
const META_GET_SQL = "SELECT value FROM meta WHERE key = ?1";
const META_SET_SQL = "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value";
// Both logs: `due_s:` (sent) and `due_x:` (cancelled) sort next to each other.
const LOGS_SQL = "SELECT substr(key, 5, 1) AS log, substr(key, 7) AS id, value FROM meta WHERE (key >= 'due_s:' AND key < 'due_s;') OR (key >= 'due_x:' AND key < 'due_x;')";
const RECORD_CANCEL_SQL = "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO NOTHING";
const RECORD_SENT_SQL = "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value";
const FORGET_LOGS_SQL = "DELETE FROM meta WHERE ((key >= 'due_s:' AND key < 'due_s;') OR (key >= 'due_x:' AND key < 'due_x;')) AND value < ?1";

const PREFS_SQL = "SELECT data FROM rows WHERE tbl = ?1 AND id = ?2";

// Only open to-dos that can matter today (review I3): habits planned for today and not done,
// anything pinned for today or tomorrow, anything due by tomorrow, a project with a session
// planned for today, and the day's kept picks on Today (the today-fill row's ids); only the
// fields the rules need; those with a reminder of their own first (see MAX_ITEM_ROWS).
// ?1 today, ?2 tomorrow, ?3 the limit, ?4 today's weekday ("mon"), ?5 the today-fill row's id.
const ITEMS_SQL = `
SELECT id,
  json_extract(data, '$.title') AS title,
  json_extract(data, '$.kind') AS kind,
  json_extract(data, '$.status') AS status,
  json_extract(data, '$.areaId') AS areaId,
  json_extract(data, '$.priority') AS priority,
  json_extract(data, '$.due') AS due,
  json_extract(data, '$.pinnedDate') AS pinnedDate,
  json_extract(data, '$.hiddenOn') AS hiddenOn,
  json_extract(data, '$.recur') AS recur,
  json_extract(data, '$.time') AS time,
  json_extract(data, '$.remindAt') AS remindAt,
  EXISTS (SELECT 1 FROM json_each(rows.data, '$.doneDates') WHERE value = ?1) AS doneToday,
  EXISTS (SELECT 1 FROM json_each(rows.data, '$.sessions') WHERE json_extract(value, '$.doneOn') = ?1) AS sessionDoneToday,
  EXISTS (SELECT 1 FROM json_each(rows.data, '$.sessions')
          WHERE json_extract(value, '$.plannedFor') = ?1 AND json_extract(value, '$.doneOn') IS NULL) AS sessionPlannedToday
FROM rows
WHERE tbl = 'items' AND json_valid(data)
  AND json_extract(data, '$.kind') = 'task'
  AND json_extract(data, '$.status') = 'open'
  AND ((json_array_length(data, '$.recur') > 0
        AND EXISTS (SELECT 1 FROM json_each(rows.data, '$.recur') WHERE value = ?4)
        AND NOT EXISTS (SELECT 1 FROM json_each(rows.data, '$.doneDates') WHERE value = ?1))
       OR (COALESCE(json_array_length(data, '$.recur'), 0) = 0
           AND (json_extract(data, '$.pinnedDate') IN (?1, ?2) OR json_extract(data, '$.due') <= ?2
                OR EXISTS (SELECT 1 FROM json_each(rows.data, '$.sessions') WHERE json_extract(value, '$.plannedFor') = ?1)
                OR rows.id IN (SELECT value FROM json_each(COALESCE(
                  (SELECT json_extract(f.data, '$.ids') FROM rows AS f WHERE f.tbl = 'prefs' AND f.id = ?5 AND json_valid(f.data)), '[]'))))))
ORDER BY
  (json_extract(data, '$.time') IS NOT NULL OR json_extract(data, '$.remindAt') IS NOT NULL) DESC,
  (json_extract(data, '$.priority') = 1 OR COALESCE(json_array_length(data, '$.recur'), 0) > 0) DESC,
  json_extract(data, '$.priority'),
  COALESCE(json_extract(data, '$.due'), '~'),
  id
LIMIT ?3`;

// Something ticked off today: a to-do done, a habit's day, a project session.
const TICKED_SQL = `
SELECT EXISTS (
  SELECT 1 FROM rows
  WHERE tbl = 'items' AND json_valid(data) AND (
    (json_extract(data, '$.status') = 'done' AND json_extract(data, '$.completedAt') = ?1)
    OR EXISTS (SELECT 1 FROM json_each(rows.data, '$.doneDates') WHERE value = ?1)
    OR EXISTS (SELECT 1 FROM json_each(rows.data, '$.sessions') WHERE json_extract(value, '$.doneOn') = ?1))
) AS ticked`;

interface ItemRow {
  id: string;
  title: unknown;
  kind: unknown;
  status: unknown;
  areaId: unknown;
  priority: unknown;
  due: unknown;
  pinnedDate: unknown;
  hiddenOn: unknown;
  recur: unknown;
  time: unknown;
  remindAt: unknown;
  doneToday: number;
  sessionDoneToday: number;
  sessionPlannedToday: number;
}

// The day's kept picks (plain JSON in `prefs`, like the Due settings).
const FILL_SQL = "SELECT data FROM rows WHERE tbl = 'prefs' AND id = ?1";

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

function weekdays(v: unknown): string[] | undefined {
  if (typeof v !== "string") return undefined;
  try {
    const list: unknown = JSON.parse(v);
    return Array.isArray(list) ? list.filter((d): d is string => typeof d === "string") : undefined;
  } catch {
    return undefined;
  }
}

function toItem(r: ItemRow): DueItem | null {
  if (typeof r.title !== "string" || typeof r.kind !== "string" || typeof r.status !== "string") return null;
  return {
    id: r.id,
    title: r.title,
    kind: r.kind,
    status: r.status,
    areaId: str(r.areaId) ?? "",
    priority: typeof r.priority === "number" ? r.priority : 3,
    due: str(r.due),
    pinnedDate: str(r.pinnedDate),
    hiddenOn: str(r.hiddenOn),
    recur: weekdays(r.recur),
    time: str(r.time),
    remindAt: str(r.remindAt),
    doneToday: r.doneToday === 1,
    sessionDoneToday: r.sessionDoneToday === 1,
    sessionPlannedToday: r.sessionPlannedToday === 1,
  };
}

/** The today-fill row's picks for `day`, read defensively (anything odd: none). */
function picksOf(data: unknown, day: string): TodayPicks | undefined {
  if (typeof data !== "string") return undefined;
  let row: unknown;
  try {
    row = JSON.parse(data);
  } catch {
    return undefined;
  }
  const r = row as { date?: unknown; ids?: unknown; dues?: unknown } | null;
  if (!r || r.date !== day || !Array.isArray(r.ids)) return undefined;
  const ids = r.ids.filter((id): id is string => typeof id === "string").slice(0, MAX_PICKS);
  const dues: Record<string, string> = {};
  if (typeof r.dues === "object" && r.dues !== null && !Array.isArray(r.dues)) {
    for (const [k, v] of Object.entries(r.dues)) if (typeof v === "string") dues[k] = v;
  }
  return { ids, dues };
}

async function readPrefs(db: D1Database): Promise<unknown> {
  const row = await db.prepare(PREFS_SQL).bind(PREFS_TABLE, DUE_PREFS_ID).first<{ data: string }>();
  if (!row) return undefined;
  try {
    return JSON.parse(row.data);
  } catch {
    return undefined;
  }
}

async function readItems(db: D1Database, day: string): Promise<{ items: DueItem[]; ticked: boolean; fill?: TodayPicks }> {
  const fillId = `today-fill:${day}`;
  const [items, ticked, fill] = await db.batch([
    db.prepare(ITEMS_SQL).bind(day, addDays(day, 1), MAX_ITEM_ROWS, weekdayOf(day), fillId),
    db.prepare(TICKED_SQL).bind(day),
    db.prepare(FILL_SQL).bind(fillId),
  ]);
  return {
    items: (items!.results as unknown as ItemRow[]).map(toItem).filter((x): x is DueItem => x !== null),
    ticked: (ticked!.results[0] as { ticked: number } | undefined)?.ticked === 1,
    fill: picksOf((fill!.results[0] as { data?: unknown } | undefined)?.data, day),
  };
}

async function metaGet(db: D1Database, key: string): Promise<number> {
  return (await db.prepare(META_GET_SQL).bind(key).first<{ value: number }>())?.value ?? 0;
}

const metaSet = (db: D1Database, key: string, value: number) => db.prepare(META_SET_SQL).bind(key, value).run();

/** The logs of ids this Worker cancelled and sent, kept in `meta`. */
async function cancelLog(db: D1Database, now: number): Promise<CancelLog> {
  await db.prepare(FORGET_LOGS_SQL).bind(now - CANCEL_LOG_MS).run();
  const { results } = await db.prepare(LOGS_SQL).all<{ log: string; id: string; value: number }>();
  const cancelled = new Set<string>();
  const sent = new Map<string, number>();
  for (const r of results) {
    if (r.log === "x") cancelled.add(r.id);
    else sent.set(r.id, r.value);
  }
  return {
    cancelled,
    sent,
    record: async (ids) => {
      await db.batch(ids.map((id) => db.prepare(RECORD_CANCEL_SQL).bind(`due_x:${id}`, now)));
      for (const id of ids) cancelled.add(id);
    },
    recordSent: async (list) => {
      await db.batch(list.map((s) => db.prepare(RECORD_SENT_SQL).bind(`due_s:${s.id}`, s.at)));
      for (const s of list) sent.set(s.id, s.at);
    },
  };
}

/** Due is configured: a token and an https address. */
function configured(env: Env): DueRunResult | null {
  if (!env.DUE_TOKEN) return { kind: "off", reason: "no_token" };
  if (!env.DUE_BASE_URL || !/^https:\/\/[^/?#\s]+/.test(env.DUE_BASE_URL)) return { kind: "off", reason: "bad_base_url" };
  return null;
}

export const isDueConfigured = (env: Env): boolean => configured(env) === null;

/** One run (cron, or `fromSync`). Never throws. */
export async function runDueReminders(env: Env, deps: DueDeps, fromSync = false): Promise<DueRunResult> {
  const off = configured(env);
  if (off) return off;
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const now = deps.now();
  const leaseUntil = started + LEASE_MS;
  try {
    if (!(await env.DB.prepare(LEASE_SQL).bind(leaseUntil, started).first())) return { kind: "busy" };
  } catch {
    console.error("due_reminders_failure", "lease");
    return { kind: "busy" };
  }
  try {
    // A run after a sync uses up the minute's gap only once it really runs (review M2).
    if (fromSync && !(await env.DB.prepare(SYNC_GAP_SQL).bind(now, now - SYNC_RUN_GAP_MS).first())) {
      return { kind: "skipped", reason: "gap" };
    }
    if ((await metaGet(env.DB, "due_backoff")) > now) return { kind: "skipped", reason: "backoff" };
    const prefs = readDuePrefs(await readPrefs(env.DB));
    if (!prefs.on && (await metaGet(env.DB, "due_off_clean")) === 1) return { kind: "skipped", reason: "off_and_clean" };
    const day = appDay(now, prefs.timeZone);
    const { items, ticked, fill } = prefs.on ? await readItems(env.DB, day) : { items: [], ticked: false, fill: undefined };
    const wanted = wantedReminders({ items, prefs, now, tickedToday: ticked, fill });
    const client = new DueClient({
      baseUrl: env.DUE_BASE_URL!, token: env.DUE_TOKEN!, fetch: deps.dueFetch, maxCalls: MAX_CALLS_PER_RUN,
      deadline: started + RUN_DEADLINE_MS, clock,
    });
    const yesterday = addDays(day, -1);
    const report = await reconcile(client, wanted, {
      timeZone: prefs.timeZone,
      now,
      days: [yesterday, day, addDays(day, 1)].map(dayToken),
      from: isoInZone(instantOf(yesterday, "00:00", prefs.timeZone), prefs.timeZone),
      log: await cancelLog(env.DB, now),
    });
    // "budget" is the 3am changeover's normal case (the rest goes next run): not worth a log line.
    // With the HTTP status, and an unreadable answer's shape (key names and types only).
    if (report.stopped && report.stopped !== "budget") {
      const status = `status=${report.stoppedStatus ?? 0}`;
      if (report.stoppedShape !== undefined) console.error("due_reminders_stopped", report.stopped, status, `shape=${report.stoppedShape}`);
      else if (report.stoppedStatus) console.error("due_reminders_stopped", report.stopped, status);
      else console.error("due_reminders_stopped", report.stopped);
    }
    if (report.stopped === "due_rejecting") await metaSet(env.DB, "due_backoff", now + BACKOFF_MS);
    // Off, and Due has nothing left of ours: later runs needn't ask Due until she turns it on.
    await metaSet(env.DB, "due_off_clean", !prefs.on && !report.stopped ? 1 : 0);
    return { kind: "ran", report };
  } catch (error) {
    console.error("due_reminders_failure", error instanceof Error ? error.name : "unknown");
    return { kind: "busy" };
  } finally {
    await env.DB.prepare(RELEASE_SQL).bind(leaseUntil).run().catch(() => undefined);
  }
}

/** A run soon after a sync that ticked something off: at most one a minute. Never throws. */
export async function runDueAfterSync(env: Env, deps: DueDeps): Promise<DueRunResult> {
  return runDueReminders(env, deps, true);
}
