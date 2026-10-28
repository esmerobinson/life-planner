import Dexie, { type Table } from "dexie";
import type { FileRow, Item, Goal } from "../domain/types";
import { installChangeTracking, legacyStamp, markTransactionUntracked } from "./changeTracking";

/** The tables that sync (files: the pictures on pages, round 3b). */
export const SYNC_TABLES = ["items", "goals", "files"] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

/**
 * One local change waiting to be sent to the sync server: the `updatedAt` of the row's
 * latest local write. Cleared only when that exact version has been sent and answered.
 */
export interface PendingChange {
  table: SyncTable;
  id: string;
  updatedAt: number;
  /**
   * The server refused this exact version on its own (400 for this one change). It stays
   * here, is not sent again, and is counted on the Sync page; a new local edit replaces the
   * entry (without the flag), so it is tried again then.
   */
  stuck?: true;
}

/**
 * Sync settings and progress, one row per key: deviceId, cursor, lastSyncedAt, serverUrl,
 * token (the token DERIVED from the passphrase, kept on this device so sync can run by
 * itself; the passphrase itself is never stored), needsPassphrase. Never part of a backup,
 * so a deviceId is never copied to another device.
 */
/**
 * A row from the sync server that this app version cannot read yet (it fails the row
 * validator, e.g. a newer build added an area). Kept, never dropped: every sync tries it
 * again and applies it, by the usual last-write-wins, once it passes.
 */
export interface QuarantinedRow {
  /** A synced table, or one only a later app version knows (kept until this app updates). */
  table: string;
  id: string;
  updatedAt: number;
  /** The row exactly as the server sent it. */
  data: Record<string, unknown>;
  reason: string;
  /** The response cursor it arrived with (rows carry no seq of their own on the wire). */
  cursor: number;
}

export interface SyncMetaRow {
  key: string;
  value: unknown;
}

export class HubDB extends Dexie {
  items!: Table<Item, string>;
  goals!: Table<Goal, string>;
  files!: Table<FileRow, string>;
  pending!: Table<PendingChange, [string, string]>;
  syncMeta!: Table<SyncMetaRow, string>;
  quarantine!: Table<QuarantinedRow, [string, string]>;

  constructor(name = "life-hub") {
    super(name);
    this.version(1).stores({
      items: "id, status, areaId, goalId, due",
      goals: "id",
    });
    // v2: sync. Every existing row gets updatedAt and is marked pending, so a device that
    // already has data uploads all of it on its first sync (where the server has nothing newer).
    this.version(2)
      .stores({
        syncMeta: "key",
        pending: "[table+id]",
      })
      .upgrade(async (tx) => {
        // Stamped explicitly below from each row's OWN dates, never "now": a device that
        // upgrades late must not beat edits other devices made since (any copy the server
        // already has is newer and wins). Not validated: old rows are kept exactly as they are.
        markTransactionUntracked(tx);
        for (const table of ["items", "goals"] as const) { // the tables v2 had
          const marks: PendingChange[] = [];
          await tx.table(table).toCollection().modify((row: { id: string; updatedAt?: number }) => {
            row.updatedAt = legacyStamp(row);
            marks.push({ table, id: row.id, updatedAt: row.updatedAt });
          });
          await tx.table("pending").bulkPut(marks);
        }
      });
    // v3: rows from the server this version cannot read yet.
    this.version(3).stores({ quarantine: "[table+id]" });
    // v4: pictures on pages (round 3b). New and empty, so nothing to stamp or mark pending.
    this.version(4).stores({ files: "id" });
    installChangeTracking(this);
  }
}

export const db = new HubDB();
