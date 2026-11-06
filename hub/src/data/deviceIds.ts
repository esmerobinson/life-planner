// This device's ids for the journal rows it keeps for itself (restore-safe, bug #31).
//
// Many journal rows belong to one device and only that device writes them, so the row id holds
// the device id (`draft:<date>:<deviceId>`, an answer's `<promptKey>:<deviceId>`, the day's
// exercise marks, stars, note ticks, exercise answers and drafts). Writing such a row again is
// safe only when this device has the newest copy of it. A Replace breaks that: the rows come
// back as they were in the (older) backup, while the server may hold newer words this device
// wrote after the backup. An edit then would get a fresh stamp and win over them everywhere.
//
// So a Replace gives the device a NEW id. Its earlier ids are kept here as "former": the rows
// with them are still this device's to read (the box opens on them), but nothing here ever
// writes them again. Each keeps the stamp it had in the backup, so a newer copy on the server
// wins its row; everything she changes after the Replace goes into rows with the new id, beside
// them, which no other copy can be newer than. Both sync to every device and are read there
// like two devices' rows always are. With no Replace the id never changes.
//
// syncMeta is never in a backup, so the ids stay with this install.

import { db } from "./db";

export const DEVICE_ID_META = "deviceId";
export const FORMER_DEVICE_IDS_META = "formerDeviceIds";

type MetaTable = typeof db.syncMeta;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : []);

/**
 * Inside the caller's transaction (which must include syncMeta): the current device id, if
 * there is one, becomes a former id and a new one is made. Nothing has been written with the new id.
 */
export async function retireDeviceId(syncMeta: MetaTable): Promise<void> {
  const current = (await syncMeta.get(DEVICE_ID_META))?.value;
  if (typeof current !== "string" || current === "") return; // no id yet: no row has one
  const former = strings((await syncMeta.get(FORMER_DEVICE_IDS_META))?.value);
  await syncMeta.put({ key: FORMER_DEVICE_IDS_META, value: [...former.filter((x) => x !== current), current] });
  await syncMeta.put({ key: DEVICE_ID_META, value: crypto.randomUUID() });
}

/** Every former id of this device (inside the caller's transaction if it includes syncMeta). */
export async function formerDeviceIds(syncMeta: MetaTable = db.syncMeta): Promise<string[]> {
  return strings((await syncMeta.get(FORMER_DEVICE_IDS_META))?.value);
}

export interface OwnDevices {
  /** The id this device writes its own rows with. */
  current: string;
  /** Its earlier ids (before a Replace), oldest first: read, never written. */
  former: string[];
}

/**
 * The ids to use for `deviceId` (what the page passed). This device's current or former id
 * means this device: it writes with its current id and also reads its former ones (a page open
 * since before a Replace still has the old id). Any other id (another device's, in tests) is
 * used as it is, with no former ids.
 */
export async function ownDevices(deviceId: string): Promise<OwnDevices> {
  const [cur, prev] = await Promise.all([db.syncMeta.get(DEVICE_ID_META), db.syncMeta.get(FORMER_DEVICE_IDS_META)]);
  const current = typeof cur?.value === "string" ? cur.value : "";
  const former = strings(prev?.value).filter((x) => x !== current);
  if (current && (deviceId === current || former.includes(deviceId))) return { current, former };
  return { current: deviceId, former: [] };
}
