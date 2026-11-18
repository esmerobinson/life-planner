import Dexie from "dexie";
import { HubDB } from "../data/db";
import { frozenFill, todayFillRow, TODAY_FILL_PREFIX } from "../domain/todayFill";
import { FakeSyncServer } from "./fakeServer";
import { getDeviceId, saveSyncSettings, syncOnce } from "./engine";

// Today's kept picks (domain/todayFill.ts) sync between her Mac and phone: a pick she removed on
// one is never refilled on the other. One row per device, so neither overwrites the other.

const TOKEN = "f1f1".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
const TUE = "2026-10-27";
let n = 0;
const open: HubDB[] = [];
afterEach(async () => {
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

async function device() {
  const d = new HubDB(`today-fill-sync-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}
const kept = async (d: HubDB) => frozenFill(await d.prefs.where("id").startsWith(TODAY_FILL_PREFIX).toArray(), TUE);

it("the Mac's picks reach the phone; both devices' picks count when both picked before syncing", async () => {
  const server = new FakeSyncServer(TOKEN);
  const mac = await device();
  const phone = await device();
  await mac.prefs.put(todayFillRow(await getDeviceId(mac), TUE, ["pretend-a", "pretend-b"], 4));
  expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
  expect(await kept(phone)).toEqual({ ids: ["pretend-a", "pretend-b"], room: 4 });

  // The phone had picked too (before it synced): its own row, never over the Mac's.
  await phone.prefs.put(todayFillRow(await getDeviceId(phone), TUE, ["pretend-c"], 4));
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
  expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
  const both = await kept(mac);
  expect(new Set(both!.ids)).toEqual(new Set(["pretend-a", "pretend-b", "pretend-c"]));
  expect(await kept(phone)).toEqual(both);
});
