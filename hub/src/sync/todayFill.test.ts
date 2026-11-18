import Dexie from "dexie";
import { HubDB } from "../data/db";
import { OWN_FILL_META, markTodayTouched, recordTodayFill } from "../data/todayFillRepo";
import { effectiveFill, todayFillRowId } from "../domain/todayFill";
import { FakeSyncServer } from "./fakeServer";
import { saveSyncSettings, syncOnce } from "./engine";

// Today's kept picks (domain/todayFill.ts) sync between her Mac and phone as ONE shared row per
// day, and the FIRST picks of the day win everywhere (fix round 1, I3). Two devices that picked
// from different data never add up to a longer list, and a device where she has already used
// Today keeps the list she is working from.

const TOKEN = "f1f1".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
const TUE = "2026-10-27";
const AT_8 = Date.UTC(2026, 9, 27, 12);
const AT_10 = AT_8 + 2 * 3600_000;
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
const shown = async (d: HubDB) =>
  effectiveFill(await d.prefs.get(todayFillRowId(TUE)), (await d.syncMeta.get(OWN_FILL_META))?.value, TUE);
const sync = async (d: HubDB, server: FakeSyncServer) => expect((await syncOnce({ db: d, fetch: server.fetch })).kind).toBe("ok");

describe("two devices pick from different data before they sync", () => {
  for (const order of ["the later device syncs first", "the earlier device syncs first"] as const) {
    it(`the earliest picks win on both, never a union (${order})`, async () => {
      const server = new FakeSyncServer(TOKEN);
      const mac = await device();
      const phone = await device();
      await recordTodayFill(TUE, { ids: ["a", "b", "c", "d"], room: 4 }, AT_8, mac); // 8am on the Mac
      await recordTodayFill(TUE, { ids: ["e", "f", "g", "h"], room: 4 }, AT_10, phone); // 10am, stale data
      const [first, second] = order === "the later device syncs first" ? [phone, mac] : [mac, phone];
      await sync(first, server);
      await sync(second, server);
      await sync(first, server);
      for (const d of [mac, phone]) {
        expect(await d.prefs.get(todayFillRowId(TUE))).toMatchObject({ ids: ["a", "b", "c", "d"], pickedAt: AT_8 });
        expect(await shown(d)).toEqual({ ids: ["a", "b", "c", "d"], room: 4 });
      }
    });
  }

  it("on a device where she has already used Today, the earlier list arrives but hers stays, and nothing is added", async () => {
    const server = new FakeSyncServer(TOKEN);
    const mac = await device();
    const phone = await device();
    await recordTodayFill(TUE, { ids: ["a", "b", "c", "d"], room: 4 }, AT_8, mac);
    await recordTodayFill(TUE, { ids: ["e", "f", "g", "h"], room: 4 }, AT_10, phone);
    await markTodayTouched(TUE, { ids: ["e", "f", "g", "h"], room: 4 }, phone); // she ticked one on the phone
    await sync(mac, server);
    await sync(phone, server);
    expect(await phone.prefs.get(todayFillRowId(TUE))).toMatchObject({ ids: ["a", "b", "c", "d"] });
    expect(await shown(phone)).toEqual({ ids: ["e", "f", "g", "h"], room: 4 });
    expect(await shown(mac)).toEqual({ ids: ["a", "b", "c", "d"], room: 4 });
  });

  it("a place filled later on the first device reaches the other", async () => {
    const server = new FakeSyncServer(TOKEN);
    const mac = await device();
    const phone = await device();
    await recordTodayFill(TUE, { ids: ["a"], room: 4 }, AT_8, mac);
    await sync(mac, server);
    await sync(phone, server);
    await recordTodayFill(TUE, { ids: ["a", "b"], room: 4 }, AT_10, mac);
    await sync(mac, server);
    await sync(phone, server);
    expect(await shown(phone)).toEqual({ ids: ["a", "b"], room: 4 });
  });
});
