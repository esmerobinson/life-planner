// Testing session (restore-safe ripples): the farm after a Replace. Its only per-device row is
// `start:<deviceId>`; the new device id must never move the farm's start, duplicate a sticker
// or lose a placement, outfit or "seen" moment. Fictional data only; fake server only.

import Dexie from "dexie";
import { db, HubDB } from "../data/db";
import { exportBackup, restoreBackup } from "../data/backup";
import { FakeSyncServer } from "../sync/fakeServer";
import { getDeviceId, saveSyncSettings, stopSyncing, syncOnce } from "../sync/engine";
import { ensureStart, markSeen, placeSticker, setOutfit } from "./farmRepo";
import { farmState } from "./state";
import { STICKER_BY_KEY } from "./catalogue";

const TOKEN = "fa40".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
const open: HubDB[] = [];
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear(), db.items.clear(), db.goals.clear(), db.files.clear(), db.farm.clear()]);
});
afterEach(async () => {
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});
const later = () => new Promise((r) => setTimeout(r, 5));
const ok = async (d: HubDB, s: FakeSyncServer) => expect((await syncOnce({ db: d, fetch: s.fetch })).kind).toBe("ok");
const stickers = [...STICKER_BY_KEY.keys()].slice(0, 2);

it("backup from before the farm opened, Replace, the farm opens offline, sync: the start stays the first day, stickers once", async () => {
  const server = new FakeSyncServer(TOKEN);
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  await getDeviceId(db);
  const backup = JSON.parse(JSON.stringify(await exportBackup("2026-11-01"))); // farm: [] (never opened)
  await ensureStart("2026-11-01");
  await markSeen(stickers[0]!, "2026-11-02");
  await placeSticker(stickers[0]!, "2026-11-02");
  await setOutfit("domino", "A1");
  await ok(db, server);
  const phone = new HubDB(`restore-farm-phone-${Math.random()}`);
  open.push(phone);
  await saveSyncSettings(phone, { serverUrl: SERVER, token: TOKEN });
  await ok(phone, server);

  await stopSyncing(db);
  await restoreBackup(backup, "replace");
  await later();
  await ensureStart("2026-11-05"); // she opens the farm before sync is back on
  await markSeen(stickers[1]!, "2026-11-05");
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  await ok(db, server);
  await ok(phone, server);
  await ok(db, server);

  for (const d of [db, phone]) {
    const s = farmState(await d.farm.toArray());
    expect(s.start).toBe("2026-11-01");
    expect([...s.seen].sort()).toEqual([...stickers].sort());
    expect(s.placed.get(stickers[0]!)).toBeDefined();
    expect(s.outfits.get("domino")).toBe("A1");
  }
  expect((await db.farm.toArray()).map((r) => r.id).sort()).toEqual((await phone.farm.toArray()).map((r) => r.id).sort());
});
