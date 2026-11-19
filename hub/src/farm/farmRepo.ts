// Esme's Farm: the farm table's reads and writes (each write is tracked and synced like every
// table). Rows only ever replace themselves, so nothing here can undo another device's facts.

import { db } from "../data/db";
import type { ISODate } from "../domain/types";
import { getDeviceId } from "../sync/engine";
import { RIO_PLACE_KEYS } from "../rio/places";
import { STICKER_BY_KEY } from "./catalogue";
import {
  arrivedRow, hiddenRow, outfitRow, placedRow, seenRow, spotRow, startRow, todayRow, validFarm, visitedRow, type CharacterId, type FarmRow,
} from "./state";

export const listFarmRows = (): Promise<FarmRow[]> => db.farm.toArray();

/** The first open of the farm on this device: its start row (when no device has one yet). */
export async function ensureStart(today: ISODate): Promise<void> {
  if ((await db.farm.where("kind").equals("start").count()) > 0) return;
  const deviceId = await getDeviceId(db);
  await db.transaction("rw", db.farm, async () => {
    if ((await db.farm.where("kind").equals("start").count()) > 0) return;
    await db.farm.put(startRow(deviceId, today));
  });
}

/** The earned moment played: the sticker is kept for good. */
export async function markSeen(sticker: string, today: ISODate): Promise<void> {
  if (!STICKER_BY_KEY.has(sticker) || (await db.farm.get(`seen:${sticker}`))) return;
  await db.farm.put(seenRow(sticker, today));
}

/**
 * The spot new placements store: "rio". In Esme's Rio a sticker's slot comes from book order in
 * its area (rio/placement.ts), so no spot is read; rows placed on the phase-1 farm keep theirs.
 */
export const RIO_SPOT = "rio";

/** She placed a sticker (in Esme's Rio). Placing is for good. */
export async function placeSticker(sticker: string, today: ISODate): Promise<void> {
  if (!STICKER_BY_KEY.has(sticker) || (await db.farm.get(`placed:${sticker}`))) return;
  await db.transaction("rw", db.farm, async () => {
    await db.farm.put(placedRow(sticker, RIO_SPOT, today));
    if (!(await db.farm.get(`seen:${sticker}`))) await db.farm.put(seenRow(sticker, today));
  });
}

export async function markArrived(character: CharacterId, today: ISODate): Promise<void> {
  if (await db.farm.get(`arrived:${character}`)) return;
  await db.farm.put(arrivedRow(character, today));
}

export async function setOutfit(character: CharacterId, item: string | null): Promise<void> {
  await db.farm.put(outfitRow(character, item));
}

/** Today's list was seen finished today (once per day). */
export async function recordTodayDone(today: ISODate): Promise<void> {
  if (await db.farm.get(`today:${today}`)) return;
  await db.farm.put(todayRow(today));
}

const RIO_PLACES: ReadonlySet<string> = new Set(RIO_PLACE_KEYS);

/** She opened an area of Esme's Rio (once: the map's NEW badge goes for good). */
export async function markVisited(area: string, today: ISODate): Promise<void> {
  if (!RIO_PLACES.has(area) || (await db.farm.get(`visited:${area}`))) return;
  await db.farm.put(visitedRow(area, today));
}

/** She hid a placed sticker from its scene (true), or showed it again (false). Nothing is deleted. */
export async function setHidden(sticker: string, hidden: boolean, today: ISODate): Promise<void> {
  if (!STICKER_BY_KEY.has(sticker)) return;
  await db.farm.put(hiddenRow(sticker, hidden, today));
}

/** She moved a placed sticker to another slot of its scene. A slot id that isn't one is refused. */
export async function moveSticker(sticker: string, slot: string, today: ISODate): Promise<void> {
  if (!STICKER_BY_KEY.has(sticker)) return;
  const row = spotRow(sticker, slot, today);
  if (!validFarm(row)) throw new Error(`Not a slot: ${slot}`);
  await db.farm.put(row);
}
