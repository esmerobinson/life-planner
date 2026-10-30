// The sync engine: one `syncOnce` run sends this device's pending changes to the sync
// server and applies what comes back, following the v1.1 contract
// (docs/superpowers/specs/2026-10-28-sync-api.md plus its v1.1 amendments).
//
// One run is a loop of POST /v1/sync requests:
//   1. build a batch from `pending` (at most 500 changes and 1 MB of JSON), each change
//      carrying the full row (with its own id and updatedAt);
//   2. send it with the stored cursor;
//   3. apply the response in ONE IndexedDB transaction: clear the pending entries whose
//      sent version is still the latest local one, apply each returned row unless this
//      device has a NEWER (or tied) local change to it waiting (that change stays pending
//      and is sent later; the server then returns the winner), store the new cursor;
//   4. repeat while there are unsent pending changes or the server says hasMore.
// Errors: 401 clears the stored token and stops (never retried automatically); 429 reports
// Retry-After; 409 cursor_ahead resets the cursor to 0 and re-sends every local row; 400
// bad_change re-stamps far-future pending changes to now and retries once; anything else
// (including no network) leaves every local change pending.

import { applyUntracked } from "../data/changeTracking";
import { withSyncLock } from "../data/syncGate";
import { validFile, validGoal, validItem, validJournal } from "../data/validate";
import { retireCandidateForToken } from "../journal/keyStore";
import { SYNC_TABLES, type HubDB, type SyncTable } from "../data/db";

/** The deployed sync server. The Sync page offers it when no address is saved (still editable). */
export const DEFAULT_SYNC_URL = "https://esmeworld-sync.esme-brain.workers.dev";

/** Contract limits for one request (the server allows more; these keep requests small). */
export const MAX_CHANGES_PER_REQUEST = 500;
export const MAX_REQUEST_BYTES = 1_000_000;
/** A pending change stamped further ahead than this is re-stamped to now after a 400 bad_change. */
export const FUTURE_RESTAMP_MS = 23 * 60 * 60 * 1000;
/** Fallback wait when a 429 has no usable Retry-After. */
export const DEFAULT_RETRY_AFTER_MS = 60_000;
/** One change as the server stores it (`{t,i,u,d: JSON text of data}`): at most this many bytes. */
export const MAX_ROW_BYTES = 1_000_000;
/** Safety stop for one run's request loop: 200 rounds is 100,000 rows, far more than a run needs. */
export const MAX_ROUNDS = 200;

export const NEEDS_PASSPHRASE_MESSAGE = "The passphrase was not accepted. Enter it again to keep syncing.";
export const OFFLINE_MESSAGE = "Could not reach the sync server. Your changes are kept on this device and will sync later.";
export const RATE_LIMITED_MESSAGE = "The sync server asked to wait a little. Sync will try again by itself.";
export const TOO_LARGE_MESSAGE = "A change was too large to sync. It is kept on this device.";
export const REJECTED_MESSAGE = "The sync server did not accept a change. Your changes are kept on this device.";
export const FAILED_MESSAGE = "Sync did not work this time. Your changes are kept on this device.";
export const STOPPED_EARLY_MESSAGE = "Sync stopped before it finished. It will carry on next time.";

export type SyncOutcome =
  /** `held`: changes the server would refuse (or did, one by one); kept here, marked stuck. */
  | { kind: "ok"; sent: number; received: number; held: number }
  | { kind: "not-configured" }
  /** The run used a token that was replaced while it was in flight; run again. */
  | { kind: "superseded" }
  | { kind: "needs-passphrase"; message: string }
  | { kind: "rate-limited"; retryAfterMs: number; message: string }
  | { kind: "offline"; message: string }
  | { kind: "error"; message: string };

export interface SyncEnv {
  db: HubDB;
  fetch: typeof fetch;
}

interface WireChange {
  table: SyncTable;
  id: string;
  updatedAt: number;
  data: Record<string, unknown>;
}

// ---- settings (syncMeta) ----------------------------------------------------------------

export type MetaKey =
  | "deviceId"
  | "cursor"
  | "lastSyncedAt"
  | "token"
  | "serverUrl"
  | "needsPassphrase"
  /** The address the stored cursor belongs to. */
  | "cursorServerUrl"
  /** This device has pulled everything the server had at least once. */
  | "firstPullDone"
  /** Bumped every time a token is saved, so an old run's 401 cannot delete a newer token. */
  | "tokenVersion"
  /** The token version the server last accepted in a whole run (confirms a journal key). */
  | "acceptedTokenVersion";

export async function getMeta<T = unknown>(db: HubDB, key: MetaKey): Promise<T | undefined> {
  return (await db.syncMeta.get(key))?.value as T | undefined;
}

export async function setMeta(db: HubDB, key: MetaKey, value: unknown): Promise<void> {
  await db.syncMeta.put({ key, value });
}

/** This install's random device id (made once, never copied: syncMeta is not in backups). */
export async function getDeviceId(db: HubDB): Promise<string> {
  return db.transaction("rw", db.syncMeta, async () => {
    const have = await getMeta<string>(db, "deviceId");
    if (have) return have;
    const id = crypto.randomUUID();
    await setMeta(db, "deviceId", id);
    return id;
  });
}

/** Stores the address and the DERIVED token (never the passphrase) and re-enables sync. */
export async function saveSyncSettings(db: HubDB, s: { serverUrl: string; token: string }): Promise<void> {
  const serverUrl = normaliseAddress(s.serverUrl);
  // Under the sync lock: a run still in flight against the old address finishes first, so it
  // cannot send the re-marked rows there or write its cursor over the fresh start.
  await withSyncLock(db, () => saveUnderLock(db, serverUrl, s.token));
}

async function saveUnderLock(db: HubDB, serverUrl: string, token: string): Promise<void> {
  await db.transaction("rw", [...syncTables(db), db.pending, db.syncMeta], async () => {
    // A different address is a different server: its cursor means nothing here, and rows
    // already "sent" went somewhere else. Start over: pull everything, send everything.
    if ((await getMeta<string>(db, "cursorServerUrl")) !== serverUrl) {
      await startOver(db);
      await setMeta(db, "cursorServerUrl", serverUrl);
    }
    await setMeta(db, "serverUrl", serverUrl);
    await setMeta(db, "token", token);
    await setMeta(db, "tokenVersion", ((await getMeta<number>(db, "tokenVersion")) ?? 0) + 1);
    await db.syncMeta.delete("needsPassphrase");
  });
}

/**
 * Lets changes the server refused one by one be tried again (their cause may have been
 * temporary, e.g. a wrong device clock). Called once per app start and on "Sync now"; a
 * change that is still refused is found again by bisecting and stays counted.
 */
export async function retryStuck(db: HubDB): Promise<void> {
  await db.transaction("rw", db.pending, async () => {
    for (const p of await db.pending.filter((x) => x.stuck === true).toArray()) {
      const { stuck: _s, ...rest } = p;
      await db.pending.put(rest);
    }
  });
}

/** Every synced table of `db`, for transactions that must cover them all. */
const syncTables = (db: HubDB) => SYNC_TABLES.map((t) => db.table(t));

/** Trimmed, without trailing slashes, so "https://x/" and "https://x" are one address. */
export function normaliseAddress(text: string): string {
  return text.trim().replace(/\/+$/, "");
}

/**
 * Cursor 0, no last-sync time, first pull not done, and EVERY local row pending again
 * (with its current stamp, so nothing is re-dated). Runs inside the caller's transaction,
 * which must include every synced table, pending and syncMeta.
 */
async function startOver(db: HubDB): Promise<void> {
  for (const table of SYNC_TABLES) {
    const rows = (await db.table(table).toArray()) as { id: string; updatedAt?: number }[];
    await db.pending.bulkPut(rows.map((r) => ({ table, id: r.id, updatedAt: r.updatedAt ?? 1 })));
  }
  await db.syncMeta.put({ key: "cursor", value: 0 });
  await db.syncMeta.delete("lastSyncedAt");
  await db.syncMeta.delete("firstPullDone");
}

/** Stops syncing on this device: forgets the token. Local data and pending changes stay. */
export async function stopSyncing(db: HubDB): Promise<void> {
  await db.transaction("rw", db.syncMeta, async () => {
    await db.syncMeta.delete("token");
    await db.syncMeta.delete("needsPassphrase");
  });
}

// ---- one run ----------------------------------------------------------------------------

/** The row check for each synced table (the same one every local write passes). */
const VALID_ROW: Record<SyncTable, (r: unknown) => boolean> = {
  items: validItem, goals: validGoal, files: validFile, journal: validJournal,
};
/** A table this build syncs (a later build may add more; their rows are skipped here). */
const isSyncTable = (t: unknown): t is SyncTable => (SYNC_TABLES as readonly unknown[]).includes(t);

const keyOf = (table: string, id: string) => `${table}\u0000${id}`;
const utf8Length = (s: string) => new TextEncoder().encode(s).length;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Runs a whole sync. Never throws for network or server problems; returns what happened. */
export async function syncOnce(env: SyncEnv): Promise<SyncOutcome> {
  // One run at a time per database, across tabs too (and never during a restore).
  return withSyncLock(env.db, () => run(env));
}

async function run({ db, fetch }: SyncEnv): Promise<SyncOutcome> {
  const serverUrl = await getMeta<string>(db, "serverUrl");
  const token = await getMeta<string>(db, "token");
  const tokenVersion = await getMeta<number>(db, "tokenVersion");
  if (!serverUrl || !token) return { kind: "not-configured" };
  const deviceId = await getDeviceId(db);
  const url = `${serverUrl.replace(/\/+$/, "")}/v1/sync`;

  let received = await retryQuarantine(db);
  let cursor = (await getMeta<number>(db, "cursor")) ?? 0;
  const attempted = new Set<string>(); // keys sent in this run (re-edits wait for the next run)
  let needPull = true;
  let hasMore = false;
  let cursorReset = false;
  let badChangeRetried = false;
  let sent = 0;
  let held = 0;
  /** Halves of a batch the server refused with 400, being narrowed down to the culprit(s). */
  const probes: Batch[] = [];
  let finished = false;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const probing = probes.length > 0;
    let batch: Batch;
    if (probing) batch = probes.shift()!;
    else {
      const built = await buildBatch(db, deviceId, cursor, attempted);
      for (const k of built.held) attempted.add(k);
      held += built.held.length;
      batch = built;
      if (!needPull && !hasMore && batch.changes.length === 0) {
        finished = true;
        break;
      }
    }
    const body = JSON.stringify({ deviceId, cursor, changes: batch.changes });

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body,
      });
    } catch {
      return { kind: "offline", message: OFFLINE_MESSAGE };
    }

    if (!res.ok) {
      const code = await errorCode(res);
      if (res.status === 401) {
        // Only forget the token THIS run used: one saved meanwhile (Sync page) is kept.
        const stillSame = await db.transaction("rw", db.syncMeta, async () => {
          const same =
            (await getMeta<string>(db, "token")) === token &&
            (await getMeta<number>(db, "tokenVersion")) === tokenVersion;
          if (same) {
            await db.syncMeta.delete("token");
            await setMeta(db, "needsPassphrase", true);
            // A journal key CANDIDATE made from that same (refused) passphrase is retired: it
            // can never be confirmed (journal review C1). A confirmed journal key is never touched.
            await retireCandidateForToken(db, tokenVersion);
          }
          return same;
        });
        if (!stillSame) return { kind: "superseded" };
        return { kind: "needs-passphrase", message: NEEDS_PASSPHRASE_MESSAGE };
      }
      if (res.status === 429) {
        return { kind: "rate-limited", retryAfterMs: retryAfterMs(res.headers.get("Retry-After")), message: RATE_LIMITED_MESSAGE };
      }
      if (res.status === 409 && code === "cursor_ahead" && !cursorReset) {
        cursorReset = true;
        cursor = 0;
        await resetForCursorAhead(db);
        attempted.clear();
        needPull = true;
        hasMore = false;
        continue;
      }
      if (res.status === 400 && code === "bad_change" && !badChangeRetried && !probing) {
        badChangeRetried = true; // a wrong clock: re-stamp far-future changes, retry once
        await restampFarFuture(db);
        continue;
      }
      if (res.status === 400 && (code === "bad_change" || code === "row_too_large")) {
        // One (or a few) changes are refused. Split the batch until each culprit is alone,
        // hold those back (kept here, marked stuck) and let everything else through.
        if (batch.changes.length > 1) {
          const half = Math.ceil(batch.changes.length / 2);
          probes.unshift(
            { changes: batch.changes.slice(0, half), pendingVersions: batch.pendingVersions },
            { changes: batch.changes.slice(half), pendingVersions: batch.pendingVersions },
          );
          continue;
        }
        if (batch.changes.length === 1) {
          const [only] = batch.changes;
          await markStuck(db, [{ key: keyOf(only!.table, only!.id), table: only!.table, id: only!.id }], batch.pendingVersions);
          attempted.add(keyOf(only!.table, only!.id));
          held++;
          continue;
        }
      }
      if (res.status === 413) return { kind: "error", message: TOO_LARGE_MESSAGE };
      if (res.status === 400) return { kind: "error", message: REJECTED_MESSAGE };
      return { kind: "error", message: FAILED_MESSAGE };
    }

    let reply: { cursor: number; hasMore: boolean; changes: WireChange[] };
    try {
      reply = parseReply(await res.json());
    } catch {
      return { kind: "error", message: FAILED_MESSAGE };
    }

    received += await applyReply(db, batch.changes, batch.pendingVersions, reply);
    for (const c of batch.changes) attempted.add(keyOf(c.table, c.id));
    sent += batch.changes.length;
    cursor = reply.cursor;
    hasMore = reply.hasMore;
    needPull = false;
  }
  // The loop ran out while there was still work: say so rather than loop on.
  if (!finished) return { kind: "error", message: STOPPED_EARLY_MESSAGE };
  // The server accepted this token for a whole run: remember which version (the journal key
  // made with the same passphrase may now be confirmed, journal/keyStore.ts).
  await db.transaction("rw", db.syncMeta, async () => {
    if ((await getMeta<string>(db, "token")) === token && (await getMeta<number>(db, "tokenVersion")) === tokenVersion) {
      await setMeta(db, "acceptedTokenVersion", tokenVersion ?? null);
    }
  });
  return { kind: "ok", sent, received, held };
}

interface Batch {
  changes: WireChange[];
  /** The pending entry's updatedAt when the request was built, per key. */
  pendingVersions: Map<string, number>;
}

/** Marks changes the server refused as stuck, if they are still the version that was sent. */
async function markStuck(db: HubDB, keys: { key: string; table: SyncTable; id: string }[], versions: Map<string, number>) {
  await db.transaction("rw", db.pending, async () => {
    for (const k of keys) {
      const p = await db.pending.get([k.table, k.id]);
      if (p && p.updatedAt === versions.get(k.key)) await db.pending.put({ ...p, stuck: true });
    }
  });
}

/** Pending changes not yet attempted in this run, within the count and size limits. */
async function buildBatch(db: HubDB, deviceId: string, cursor: number, attempted: Set<string>) {
  return db.transaction("rw", [...syncTables(db), db.pending], async () => {
    const changes: WireChange[] = [];
    /** The pending entry's updatedAt when the request was built, per key. */
    const pendingVersions = new Map<string, number>();
    const held: string[] = [];
    const base = utf8Length(JSON.stringify({ deviceId, cursor, changes: [] }));
    let bytes = base;
    for (const p of await db.pending.toArray()) {
      const key = keyOf(p.table, p.id);
      if (attempted.has(key) || p.stuck) continue;
      const row = (await db.table(p.table).get(p.id)) as { updatedAt?: number } | undefined;
      if (!row) {
        await db.pending.delete([p.table, p.id]); // the row is gone (e.g. replaced by a restore)
        continue;
      }
      const updatedAt = row.updatedAt ?? p.updatedAt;
      const change: WireChange = { table: p.table, id: p.id, updatedAt, data: { ...row, id: p.id, updatedAt } };
      const own = utf8Length(JSON.stringify(change));
      const asStored = utf8Length(JSON.stringify({ t: p.table, i: p.id, u: updatedAt, d: JSON.stringify(change.data) }));
      if (base + own > MAX_REQUEST_BYTES || asStored > MAX_ROW_BYTES) {
        // Could never be sent: kept here, marked stuck (until edited again), never lost.
        await db.pending.put({ ...p, stuck: true });
        held.push(key);
        continue;
      }
      const size = own + (changes.length > 0 ? 1 : 0);
      if (changes.length >= MAX_CHANGES_PER_REQUEST) break;
      if (changes.length > 0 && bytes + size > MAX_REQUEST_BYTES) break;
      changes.push(change);
      pendingVersions.set(key, p.updatedAt);
      bytes += size;
    }
    return { changes, pendingVersions, held };
  });
}

/** Applies one response in ONE transaction. Returns how many rows were written. */
async function applyReply(
  db: HubDB,
  sentChanges: WireChange[],
  pendingVersions: Map<string, number>,
  reply: { cursor: number; hasMore: boolean; changes: WireChange[] },
): Promise<number> {
  return applyUntracked(db, async () => {
    // The sent versions are answered: clear them unless the row was edited again meanwhile.
    for (const c of sentChanges) {
      const p = await db.pending.get([c.table, c.id]);
      if (p && p.updatedAt === pendingVersions.get(keyOf(c.table, c.id))) await db.pending.delete([c.table, c.id]);
    }
    let written = 0;
    for (const c of reply.changes) {
      // A table only a later app version knows: never fatal, so this device keeps syncing.
      // The row waits in quarantine; after the update, retryQuarantine applies it.
      if (!isSyncTable(c.table)) {
        await holdForLater(db, c, reply.cursor);
        continue;
      }
      if (await applyRow(db, c, reply.cursor)) written++;
    }
    await db.syncMeta.put({ key: "cursor", value: reply.cursor });
    // Everything the server had has now been seen once: Merge and imports may run.
    if (!reply.hasMore) await db.syncMeta.put({ key: "firstPullDone", value: true });
    await db.syncMeta.put({ key: "lastSyncedAt", value: Date.now() });
    return written;
  });
}

/**
 * Applies one row from the server inside the caller's untracked transaction. Returns true
 * when it was written.
 * - v1.1 F.3: a local change still waiting (made while the request was in flight, or not
 *   sent yet) that is NEWER than the row stays and is sent later. A tie stays too: only
 *   the server can break it (by deviceId), and it answers with the winner. An OLDER
 *   waiting change has already lost: the row replaces it.
 * - An old copy never replaces a newer synced local row.
 * - A row this app version cannot read goes to quarantine instead of being dropped.
 */
async function applyRow(db: HubDB, c: WireChange, cursor: number): Promise<boolean> {
  const waiting = await db.pending.get([c.table, c.id]);
  if (waiting && waiting.updatedAt >= c.updatedAt) return false;
  const local = (await db.table(c.table).get(c.id)) as { updatedAt?: number } | undefined;
  if (!waiting && typeof local?.updatedAt === "number" && local.updatedAt > c.updatedAt) return false; // stale repeat
  const row = { ...c.data, id: c.id, updatedAt: c.updatedAt };
  const held = await db.quarantine.get([c.table, c.id]);
  if (!VALID_ROW[c.table](row)) {
    if (!held || held.updatedAt <= c.updatedAt) {
      await db.quarantine.put({
        table: c.table, id: c.id, updatedAt: c.updatedAt, data: c.data,
        reason: "This version of the app cannot read it yet.", cursor,
      });
    }
    return false;
  }
  await db.table(c.table).put(row);
  if (waiting) await db.pending.delete([c.table, c.id]);
  if (held && held.updatedAt <= c.updatedAt) await db.quarantine.delete([c.table, c.id]);
  return true;
}

/** Keeps a row of an unknown table in quarantine (the newest version of it only). */
async function holdForLater(db: HubDB, c: { table: string; id: string; updatedAt: number; data: Record<string, unknown> }, cursor: number) {
  const held = await db.quarantine.get([c.table, c.id]);
  if (held && held.updatedAt > c.updatedAt) return;
  await db.quarantine.put({
    table: c.table, id: c.id, updatedAt: c.updatedAt, data: c.data,
    reason: "A later version of the app syncs this.", cursor,
  });
}

/**
 * Tries every quarantined row again (after an app update it may now be readable) and
 * applies it by the usual rules; a row that is now outdated is dropped. ONE transaction.
 */
async function retryQuarantine(db: HubDB): Promise<number> {
  if ((await db.quarantine.count()) === 0) return 0;
  return applyUntracked(db, async () => {
    let written = 0;
    for (const q of await db.quarantine.toArray()) {
      if (!isSyncTable(q.table)) continue; // kept for a later version that knows the table
      const row = { ...q.data, id: q.id, updatedAt: q.updatedAt };
      if (!VALID_ROW[q.table](row)) continue; // still unreadable
      await db.quarantine.delete([q.table, q.id]);
      if (await applyRow(db, { table: q.table, id: q.id, updatedAt: q.updatedAt, data: q.data }, q.cursor)) written++;
    }
    return written;
  });
}

/** 409 cursor_ahead (the server was reset or restored): start over, as for a new address. */
async function resetForCursorAhead(db: HubDB): Promise<void> {
  await applyUntracked(db, () => startOver(db));
}

/** 400 bad_change: pending changes stamped more than 23 h ahead (a wrong clock) become now. */
async function restampFarFuture(db: HubDB): Promise<void> {
  await applyUntracked(db, async () => {
    const now = Date.now();
    for (const p of await db.pending.toArray()) {
      if (p.updatedAt <= now + FUTURE_RESTAMP_MS) continue;
      const row = (await db.table(p.table).get(p.id)) as object | undefined;
      if (row) await db.table(p.table).put({ ...row, updatedAt: now });
      await db.pending.put({ ...p, updatedAt: now });
    }
  });
}

async function errorCode(res: Response): Promise<string | undefined> {
  try {
    const body: unknown = await res.json();
    return isObj(body) && typeof body.error === "string" ? body.error : undefined;
  } catch {
    return undefined;
  }
}

/** Retry-After as seconds or an HTTP date; a sensible default when missing or odd. */
export function retryAfterMs(header: string | null, now = Date.now()): number {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1000, seconds * 1000);
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.max(1000, at - now);
  }
  return DEFAULT_RETRY_AFTER_MS;
}

function parseReply(body: unknown): { cursor: number; hasMore: boolean; changes: WireChange[] } {
  if (!isObj(body)) throw new Error("bad reply");
  const { cursor, hasMore, changes } = body;
  if (typeof cursor !== "number" || !Number.isSafeInteger(cursor) || cursor < 0) throw new Error("bad cursor");
  if (typeof hasMore !== "boolean" || !Array.isArray(changes)) throw new Error("bad reply");
  for (const c of changes as unknown[]) {
    if (
      !isObj(c) ||
      typeof c.table !== "string" ||
      typeof c.id !== "string" ||
      typeof c.updatedAt !== "number" ||
      !isObj(c.data)
    ) {
      throw new Error("bad change");
    }
  }
  return { cursor, hasMore, changes: changes as WireChange[] };
}
