import Dexie, { type Table } from "dexie";
import type { Item, Goal } from "../domain/types";
import { installChangeTracking, legacyStamp, markTransactionUntracked } from "./changeTracking";

/** The two tables that sync. */
export const SYNC_TABLES = ["items", "goals"] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

/**
 * One local change waiting to be sent to the sync server: the `updatedAt` of the row's
 * latest local write. Cleared only when that exact version has been sent and answered.
 */
export interface PendingChange {
  table: SyncTable;
  id: string;
  updatedAt: number;
}

/**
 * Sync settings and progress, one row per key: deviceId, cursor, lastSyncedAt, serverUrl,
 * token (the token DERIVED from the passphrase, kept on this device so sync can run by
 * itself; the passphrase itself is never stored), needsPassphrase. Never part of a backup,
 * so a deviceId is never copied to another device.
 */
export interface SyncMetaRow {
  key: string;
  value: unknown;
}

export class HubDB extends Dexie {
  items!: Table<Item, string>;
  goals!: Table<Goal, string>;
  pending!: Table<PendingChange, [string, string]>;
  syncMeta!: Table<SyncMetaRow, string>;

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
        for (const table of SYNC_TABLES) {
          const marks: PendingChange[] = [];
          await tx.table(table).toCollection().modify((row: { id: string; updatedAt?: number }) => {
            row.updatedAt = legacyStamp(row);
            marks.push({ table, id: row.id, updatedAt: row.updatedAt });
          });
          await tx.table("pending").bulkPut(marks);
        }
      });
    installChangeTracking(this);
  }
}

export const db = new HubDB();
