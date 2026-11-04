// Esme's Farm: the farm table's reads and writes (each write is tracked and synced like every
// table). Rows only ever replace themselves, so nothing here can undo another device's facts.

import { db } from "../data/db";
import type { ISODate } from "../domain/types";
import { getDeviceId } from "../sync/engine";
import { STICKER_BY_KEY } from "./catalogue";
import {
  arrivedRow, outfitRow, placedRow, seenRow, startRow, todayRow, type CharacterId, type FarmRow,
} from "./state";
import { spotIdOf } from "./world";

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

/** She placed a sticker on the farm (at its one fixed spot). Placing is for good. */
export async function placeSticker(sticker: string, today: ISODate): Promise<void> {
  if (!STICKER_BY_KEY.has(sticker) || (await db.farm.get(`placed:${sticker}`))) return;
  await db.transaction("rw", db.farm, async () => {
    await db.farm.put(placedRow(sticker, spotIdOf(sticker), today));
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
