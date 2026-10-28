// Change tracking for sync: EVERY local write to `items`, `goals` or `files` gets
//   updatedAt = max(Date.now(), previous updatedAt + 1)
// and a `pending` entry, in the SAME IndexedDB transaction as the write.
//
// This is a Dexie DBCore middleware rather than table hooks: a hook cannot write to the
// `pending` table when the caller's transaction did not name it (repo code, importers and
// restores open transactions on `items`/`goals` only). The middleware widens every
// read-write transaction that touches a synced table to include `pending`, so the stamp and
// the pending mark always commit (or roll back) together with the row. It sees every write
// path: add, put, bulkAdd, bulkPut, update, modify, and the upgrade transaction.
//
// Writes made while applying server changes run inside `applyUntracked`, whose transaction
// is skipped here: the server's row keeps its own updatedAt and is not sent back.

import Dexie from "dexie";
import type { DBCore, DBCoreMutateRequest, DBCoreMutateResponse, DBCoreTable, DBCoreTransaction, Transaction } from "dexie";
import { validFile, validGoal, validItem } from "./validate";

/** The synced tables, each with the row check other devices apply and its name in messages. */
const TRACKED_TABLES: Record<string, { valid: (r: unknown) => boolean; noun: string }> = {
  items: { valid: validItem, noun: "task" },
  goals: { valid: validGoal, noun: "goal" },
  files: { valid: validFile, noun: "picture" },
};
const TRACKED = new Set(Object.keys(TRACKED_TABLES));
const PENDING = "pending";

/** IndexedDB transactions whose writes are applied server changes (or the migration). */
const untracked = new WeakSet<object>();
/** Transactions whose rows keep their OWN stamp (imports and restores): see keepOwnStamps. */
const ownStamps = new WeakSet<object>();
/** Transactions whose listeners have already been told (one notice per transaction). */
const announced = new WeakSet<object>();
const listeners = new WeakMap<Dexie, Set<() => void>>();

/** Marks a transaction (from inside its scope) so the tracker leaves its writes alone. */
export function markTransactionUntracked(tx: Transaction): void {
  untracked.add(idbOf(tx));
}

function idbOf(tx: Transaction): object {
  const idb = (tx as unknown as { idbtrans?: object }).idbtrans;
  if (!idb) throw new Error("transaction has no IndexedDB transaction yet");
  return idb;
}

/**
 * Marks the CURRENT transaction (call it first thing inside `db.transaction(...)`) so the rows
 * it writes keep their own stamp instead of "now": the row's `updatedAt` if it has a valid
 * one, else its `createdAt` as epoch ms, else 1. They are still validated and marked pending.
 * Used by restores and importers: rows they ADD are "what was missing", so any copy the
 * server already has (an edit made since, on another device) must win over them.
 */
export function keepOwnStamps(): void {
  const tx = Dexie.currentTransaction;
  if (!tx) throw new Error("keepOwnStamps must run inside a transaction");
  ownStamps.add(idbOf(tx));
}

const isStamp = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const dateMs = (v: unknown): number | undefined => {
  const ms = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isSafeInteger(ms) && ms > 0 ? ms : undefined;
};

/** An imported or restored row's own stamp: its updatedAt, else its createdAt, else 1. */
export function ownStamp(row: { updatedAt?: unknown; createdAt?: unknown }): number {
  if (isStamp(row.updatedAt)) return row.updatedAt;
  return dateMs(row.createdAt) ?? 1;
}

/**
 * The stamp for a row that existed before sync (the v1 -> v2 upgrade): the latest of its
 * touchedAt, updatedAt and createdAt, else 1. Never "now", so a device that upgrades late
 * cannot beat edits other devices made in the meantime.
 */
export function legacyStamp(row: { touchedAt?: unknown; updatedAt?: unknown; createdAt?: unknown }): number {
  const found = [dateMs(row.touchedAt), isStamp(row.updatedAt) ? row.updatedAt : undefined, dateMs(row.createdAt)]
    .filter((v): v is number => v !== undefined);
  return found.length > 0 ? Math.max(...found) : 1;
}

/**
 * Runs `fn` in ONE read-write transaction over every table of `db`, with change tracking off:
 * rows are written exactly as given and nothing is marked pending. Used only to apply rows
 * that came from the sync server (and to re-stamp rows by hand when the server rejects them).
 */
export function applyUntracked<T>(db: Dexie, fn: () => Promise<T>): Promise<T> {
  return db.transaction("rw", db.tables, (tx) => {
    markTransactionUntracked(tx);
    return fn();
  });
}

/** Calls `fn` after each committed local (tracked) write. Returns the unsubscribe function. */
export function onLocalWrite(db: Dexie, fn: () => void): () => void {
  let set = listeners.get(db);
  if (!set) listeners.set(db, (set = new Set()));
  set.add(fn);
  return () => set.delete(fn);
}

function announce(db: Dexie, trans: DBCoreTransaction) {
  if (announced.has(trans)) return;
  announced.add(trans);
  const fire = () => listeners.get(db)?.forEach((fn) => fn());
  const target = trans as unknown as { addEventListener?: (type: string, fn: () => void) => void };
  if (typeof target.addEventListener === "function") target.addEventListener("complete", fire);
  else queueMicrotask(fire);
}

function trackTable(db: Dexie, core: DBCore, down: DBCoreTable): DBCoreTable {
  const name = down.name;
  const extractKey = down.schema.primaryKey.extractKey!;
  return {
    ...down,
    mutate(req: DBCoreMutateRequest): Promise<DBCoreMutateResponse> {
      if ((req.type !== "add" && req.type !== "put") || untracked.has(req.trans)) return down.mutate(req);
      const keys = (req.keys ?? req.values.map((v) => extractKey(v))) as string[];
      const keepOwn = ownStamps.has(req.trans);
      const existing: Promise<({ updatedAt?: number } | undefined)[]> =
        req.type === "put" && !keepOwn
          ? down.getMany({ trans: req.trans, keys })
          : Promise.resolve(keys.map(() => undefined));
      return existing.then((prev) => {
        const now = Date.now();
        const latest = new Map<string, number>(); // repeated keys inside one bulk write
        const stamps = keys.map((key, i) => {
          if (keepOwn) return ownStamp(req.values[i] as { updatedAt?: unknown; createdAt?: unknown });
          const before = latest.get(key) ?? prev[i]?.updatedAt;
          const stamp = Math.max(now, typeof before === "number" ? before + 1 : now);
          latest.set(key, stamp);
          return stamp;
        });
        // Copies: the caller's objects are never changed.
        const values = req.values.map((v, i) => ({ ...(v as object), updatedAt: stamps[i] }));
        // Nothing invalid is ever stored or sent: the same check other devices apply.
        const { valid, noun } = TRACKED_TABLES[name]!;
        const bad = values.findIndex((v) => !valid(v));
        if (bad !== -1) throw new Error(`That ${noun} could not be saved: it is not valid.`);
        return down.mutate({ ...req, values } as DBCoreMutateRequest).then((res) => {
          const marks = keys
            .map((id, i) => ({ table: name, id, updatedAt: stamps[i]! }))
            .filter((_, i) => !res.failures[i]);
          if (marks.length === 0) return res;
          return core
            .table(PENDING)
            .mutate({ type: "put", trans: req.trans, values: marks })
            .then((p) => {
              if (p.numFailures > 0) throw p.failures[0];
              announce(db, req.trans);
              return res;
            });
        });
      });
    },
  };
}

export function installChangeTracking(db: Dexie): void {
  db.use({
    stack: "dbcore",
    name: "EsmeworldChangeTracking",
    create(down: DBCore): Partial<DBCore> {
      return {
        transaction(stores, mode, options) {
          // Widen read-write transactions on synced tables so the pending mark commits with the row.
          const widened =
            mode === "readwrite" && stores.some((s) => TRACKED.has(s)) && !stores.includes(PENDING)
              ? [...stores, PENDING]
              : stores;
          return down.transaction(widened, mode, options);
        },
        table(tableName: string) {
          const table = down.table(tableName);
          return TRACKED.has(tableName) ? trackTable(db, down, table) : table;
        },
      };
    },
  });
}
