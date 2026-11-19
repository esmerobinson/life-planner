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
  itemId: string, at: Pick<DidEntry, "id" | "on" | "session">, patch: DidPatch, _today: ISODate,
): Promise<boolean> {
  return db.transaction("rw", db.items, db.syncMeta, async () => {
    const item = await db.items.get(itemId);
    if (!item || item.status === "deleted" || item.status === "purged") return false;
    const { did: _d, ...rest } = item;
    const did = withDidEntry(item.did, at, patch);
    // Nothing changed: nothing written, so no new stamp can beat another device's edit (review C1).
    if (JSON.stringify(did ?? null) === JSON.stringify(item.did ?? null)) return true;
    // touchedAt is left alone: a note isn't a change to the to-do (the farm and "not looked at"
    // read it; review M10).
    await db.items.put({ ...rest, ...(did ? { did } : {}) });
    return true;
  });
}
