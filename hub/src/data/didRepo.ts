// "What I did" notes on a to-do (2026-11-19; domain/whatIDid.ts). Written only when she types or
// keeps a file, never by the tick itself.

import { db } from "./db";
import { withDidEntry, type DidPatch } from "../domain/whatIDid";
import type { DidEntry, ISODate } from "../domain/types";

/**
 * Changes one note on a to-do (made if new), in one transaction. Resolves false when the to-do
 * is gone or in the Bin (nothing is written then).
 */
export async function saveDid(
  itemId: string, at: Pick<DidEntry, "id" | "on" | "session">, patch: DidPatch, today: ISODate,
): Promise<boolean> {
  return db.transaction("rw", db.items, db.syncMeta, async () => {
    const item = await db.items.get(itemId);
    if (!item || item.status === "deleted" || item.status === "purged") return false;
    const { did: _d, ...rest } = item;
    const did = withDidEntry(item.did, at, patch);
    await db.items.put({ ...rest, ...(did ? { did } : {}), touchedAt: today });
    return true;
  });
}
