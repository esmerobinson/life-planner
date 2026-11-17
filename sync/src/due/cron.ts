// The Due reminders run: every 15 minutes from the cron trigger (wrangler.jsonc), and soon
// after a sync that ticks something off (index.ts, never blocking the sync's answer).
//
// One run: read her settings row and her open to-dos/habits from D1 (plain JSON rows), work
// out the reminders she wants now (rules.ts), and make Due match (reconcile.ts).
//
// Safety:
// - Nothing happens at all unless the DUE_TOKEN secret and the DUE_BASE_URL var are set.
// - A lease in `meta` lets only one run talk to Due at a time (cron and sync can't race).
// - A run makes at most MAX_CALLS_PER_RUN calls to Due; Due down or refusing stops the run,
//   and the next cron run tries again. Runs started by sync are at most one a minute.
// - Logs are fixed codes only (never the token, a title or a Due answer).

import type { Env } from "../env";
import { DueClient } from "./client";
import { DUE_PREFS_ID, PREFS_TABLE, readDuePrefs } from "./prefs";
import { reconcile, type RunReport } from "./reconcile";
import { wantedReminders, type DueItem } from "./rules";
import { appDay } from "./time";

/** Workers allow 50 subrequests per invocation; this leaves room. */
export const MAX_CALLS_PER_RUN = 40;
/** How long one run may hold the lease (a run normally takes seconds). */
export const LEASE_MS = 60_000;
/** Sync-started runs: at most one per this long. */
export const SYNC_RUN_GAP_MS = 60_000;
/** The most item rows one run reads (open to-dos and habits, and today's done ones). */
export const MAX_ITEM_ROWS = 5_000;

export interface DueDeps {
  now: () => number;
  dueFetch: typeof fetch;
}

export type DueRunResult =
  | { kind: "off"; reason: "no_token" | "bad_base_url" }
  | { kind: "busy" }
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

const PREFS_SQL = "SELECT data FROM rows WHERE tbl = ?1 AND id = ?2";

// Only the fields the rules need, so a long page or a big done log is never parsed here.
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
  json_extract(data, '$.completedAt') AS completedAt,
  json_extract(data, '$.recur') AS recur,
  json_extract(data, '$.time') AS time,
  EXISTS (SELECT 1 FROM json_each(rows.data, '$.doneDates') WHERE value = ?1) AS doneToday,
  EXISTS (SELECT 1 FROM json_each(rows.data, '$.sessions') WHERE json_extract(value, '$.doneOn') = ?1) AS sessionDoneToday
FROM rows
WHERE tbl = 'items' AND json_valid(data)
  AND (json_extract(data, '$.status') = 'open' OR json_extract(data, '$.completedAt') = ?1)
LIMIT ?2`;

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
  completedAt: unknown;
  recur: unknown;
  time: unknown;
  doneToday: number;
  sessionDoneToday: number;
}

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
    completedAt: str(r.completedAt),
    recur: weekdays(r.recur),
    time: str(r.time),
    doneToday: r.doneToday === 1,
    sessionDoneToday: r.sessionDoneToday === 1,
  };
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

async function readItems(db: D1Database, day: string): Promise<DueItem[]> {
  const { results } = await db.prepare(ITEMS_SQL).bind(day, MAX_ITEM_ROWS).all<ItemRow>();
  return results.map(toItem).filter((x): x is DueItem => x !== null);
}

/** Due is configured: a token and an https address. */
function configured(env: Env): DueRunResult | null {
  if (!env.DUE_TOKEN) return { kind: "off", reason: "no_token" };
  if (!env.DUE_BASE_URL || !/^https:\/\/[^/?#\s]+/.test(env.DUE_BASE_URL)) return { kind: "off", reason: "bad_base_url" };
  return null;
}

export const isDueConfigured = (env: Env): boolean => configured(env) === null;

/** One run (cron or sync). Never throws. */
export async function runDueReminders(env: Env, deps: DueDeps): Promise<DueRunResult> {
  const off = configured(env);
  if (off) return off;
  const now = deps.now();
  const leaseUntil = now + LEASE_MS;
  try {
    const got = await env.DB.prepare(LEASE_SQL).bind(leaseUntil, now).first();
    if (!got) return { kind: "busy" };
  } catch {
    console.error("due_reminders_failure", "lease");
    return { kind: "busy" };
  }
  try {
    const prefs = readDuePrefs(await readPrefs(env.DB));
    const items = prefs.on ? await readItems(env.DB, appDay(now, prefs.timeZone)) : [];
    const wanted = wantedReminders({ items, prefs, now });
    const client = new DueClient({ baseUrl: env.DUE_BASE_URL!, token: env.DUE_TOKEN!, fetch: deps.dueFetch, maxCalls: MAX_CALLS_PER_RUN });
    const report = await reconcile(client, wanted, prefs.timeZone, now);
    if (report.stopped) console.error("due_reminders_stopped", report.stopped);
    if (report.done.rejected > 0) console.error("due_reminders_rejected", report.done.rejected);
    return { kind: "ran", report };
  } catch (error) {
    console.error("due_reminders_failure", error instanceof Error ? error.name : "unknown");
    return { kind: "busy" };
  } finally {
    await env.DB.prepare(RELEASE_SQL).bind(leaseUntil).run().catch(() => undefined);
  }
}

/** A run soon after a sync that ticked something off: at most one a minute. Never throws. */
export async function runDueAfterSync(env: Env, deps: DueDeps): Promise<DueRunResult | { kind: "skipped" }> {
  if (!isDueConfigured(env)) return configured(env)!;
  const now = deps.now();
  try {
    const got = await env.DB.prepare(SYNC_GAP_SQL).bind(now, now - SYNC_RUN_GAP_MS).first();
    if (!got) return { kind: "skipped" };
  } catch {
    return { kind: "skipped" };
  }
  return runDueReminders(env, deps);
}
