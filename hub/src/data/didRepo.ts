// "What I did" notes on a to-do (2026-11-19; domain/whatIDid.ts). Written only when she types or
// keeps a file, never by the tick itself.

import { db } from "./db";
import { noteRemovedPhotos } from "./photoPurge";
import { applyDidPatch, type DidPatch } from "../domain/whatIDid";
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
    const { did: _d, didPhotos: _p, ...rest } = item;
    const { did, didPhotos } = applyDidPatch(item, at, patch);
    // Nothing changed: nothing written, so no new stamp can beat another device's edit (review C1).
    const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    if (same(did, item.did) && same(didPhotos, item.didPhotos)) return true;
    // touchedAt is left alone: a note isn't a change to the to-do (the farm and "not looked at"
    // read it; review M10).
    await db.items.put({ ...rest, ...(did ? { did } : {}), ...(didPhotos ? { didPhotos } : {}) });
    // Photos taken off (Remove, or past the cap) are deleted once nothing shows them (review I1).
    const kept = new Set((didPhotos ?? []).flatMap((p) => p.ids));
    const had = [...(item.didPhotos ?? []).flatMap((p) => p.ids), ...(patch.addPhotos ?? [])];
    await noteRemovedPhotos(itemId, had.filter((id) => !kept.has(id)));
    return true;
  });
}
