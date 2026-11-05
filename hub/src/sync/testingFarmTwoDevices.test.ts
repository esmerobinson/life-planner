// Testing session (farm x data safety): Esme's Farm on two devices (the Mac and the phone), each
// offline for a while, then syncing through the fake server. What Esme would see if these failed:
// a sticker she placed on one device missing from the farm on the other, a sticker counted twice
// or gone, or the farm starting later than it did. Fictional data only.

import Dexie from "dexie";
import { vi } from "vitest";
import { db, HubDB } from "../data/db";
import { allEarned, counters } from "../farm/earning";
import * as repo from "../farm/farmRepo";
import { farmState, outfitRow, placedRow, seenRow, startRow, todayRow } from "../farm/state";
import { FakeSyncServer } from "./fakeServer";
import { saveSyncSettings, syncOnce } from "./engine";

const TOKEN = "fa4b".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
let clock = 1_800_000_000_000;
let n = 0;
const open: HubDB[] = [];

beforeEach(async () => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  await Promise.all([db.items.clear(), db.goals.clear(), db.farm.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear()]);
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

async function phoneDb() {
  const d = new HubDB(`farm-phone-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}
const ids = async (d: HubDB) => (await d.farm.toArray()).map((r) => r.id).sort();
const sync = async (d: HubDB, server: FakeSyncServer) => expect((await syncOnce({ db: d, fetch: server.fetch })).kind).toBe("ok");

it("placements made on both devices while offline merge: neither is lost, and the farm starts at the earlier start", async () => {
  const server = new FakeSyncServer(TOKEN);
  const phone = await phoneDb();
  // The Mac (app code paths): opened the farm on 2 Oct, placed the hen on 4 Oct.
  await repo.ensureStart("2026-10-02");
  await repo.markSeen("hi", "2026-10-02");
  await repo.placeSticker("hen", "2026-10-04");
  // The phone, offline: its own first open on 5 Oct, placed the daisy, saw Welcome too.
  clock += 60_000;
  await phone.farm.bulkPut([startRow("phonePretend01", "2026-10-05"), seenRow("hi", "2026-10-05"), placedRow("daisy", "daisy", "2026-10-05"), seenRow("daisy", "2026-10-05")]);

  await sync(db, server);
  await sync(phone, server);
  await sync(db, server);

  const want = (await ids(db)).filter((id) => !id.startsWith("start:"));
  expect(want).toEqual(["placed:daisy", "placed:hen", "seen:daisy", "seen:hen", "seen:hi"]);
  expect((await ids(phone)).filter((id) => !id.startsWith("start:"))).toEqual(want);
  for (const d of [db, phone]) {
    const s = farmState(await d.farm.toArray());
    expect(s.start).toBe("2026-10-02");
    expect([...s.placed.keys()].sort()).toEqual(["daisy", "hen"]);
  }
});

it("the same sticker earned on both devices for the same day: one row, counted once on each, never vanishes", async () => {
  const server = new FakeSyncServer(TOKEN);
  const phone = await phoneDb();
  await db.farm.bulkPut([startRow("macPretend01", "2026-10-02"), seenRow("lilypad", "2026-10-06")]);
  clock += 1000;
  await phone.farm.bulkPut([startRow("phonePretend01", "2026-10-02"), seenRow("lilypad", "2026-10-06")]);
  // And both placed it, offline.
  clock += 1000;
  await repo.placeSticker("lilypad", "2026-10-06");
  clock += 1000;
  await phone.farm.put(placedRow("lilypad", "lilypad", "2026-10-06"));

  await sync(db, server);
  await sync(phone, server);
  await sync(db, server);
  for (const d of [db, phone]) {
    const rows = await d.farm.toArray();
    expect(rows.filter((r) => r.id === "seen:lilypad")).toHaveLength(1);
    expect(rows.filter((r) => r.id === "placed:lilypad")).toHaveLength(1);
    const s = farmState(rows);
    const earned = allEarned(null, s.seen, s.placed);
    expect(earned.filter((k) => k === "lilypad")).toHaveLength(1);
  }
});

it("a device whose data earns fewer stickers (journal locked there, a to-do unticked) still shows every sticker the other saw", async () => {
  const server = new FakeSyncServer(TOKEN);
  const phone = await phoneDb();
  // The Mac saw three stickers; the phone has none of the data behind them (journal locked, nothing ticked).
  await db.farm.bulkPut([startRow("macPretend01", "2026-10-02"), ...["hi", "lilypad", "seeds-mind"].map((k) => seenRow(k, "2026-10-03"))]);
  await sync(db, server);
  await sync(phone, server);
  const s = farmState(await phone.farm.toArray());
  const c = counters({ start: s.start!, today: "2026-10-10", items: [], goals: [], todayDone: [], journal: null });
  expect(allEarned(c, s.seen, s.placed).sort()).toEqual(["hi", "lilypad", "seeds-mind"]);
});

it("re-running the app's writes (reload, re-save, the next day) never adds a second row or moves a date", async () => {
  await repo.ensureStart("2026-10-02");
  await repo.markSeen("lilypad", "2026-10-03");
  await repo.placeSticker("lilypad", "2026-10-04");
  await repo.recordTodayDone("2026-10-04");
  const before = await db.farm.toArray();
  // A reload, an Edit/re-save and the 3am change: the same calls again, on later days.
  await repo.ensureStart("2026-10-05");
  await repo.markSeen("lilypad", "2026-10-05");
  await repo.placeSticker("lilypad", "2026-10-05");
  await repo.recordTodayDone("2026-10-04");
  expect(await db.farm.toArray()).toEqual(before);
  expect(await db.pending.count()).toBe(before.length);
});

it("rows written on both devices that differ (outfit, today) settle the same on both", async () => {
  const server = new FakeSyncServer(TOKEN);
  const phone = await phoneDb();
  await db.farm.bulkPut([outfitRow("bap", "A1"), todayRow("2026-10-06")]);
  clock += 5000;
  await phone.farm.bulkPut([outfitRow("bap", "H4"), todayRow("2026-10-06"), todayRow("2026-10-07")]);
  await sync(db, server);
  await sync(phone, server);
  await sync(db, server);
  for (const d of [db, phone]) {
    expect(await d.farm.get("outfit:bap")).toMatchObject({ item: "H4" }); // her later pick
    expect(farmState(await d.farm.toArray()).todayDone).toEqual(["2026-10-06", "2026-10-07"]);
  }
});
