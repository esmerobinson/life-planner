import Dexie from "dexie";
import { HubDB } from "../data/db";
import type { Item } from "../domain/types";
import { FakeSyncServer } from "./fakeServer";
import { saveSyncSettings, syncOnce } from "./engine";

// Re-review R-M1: "synced this session" (Today's picks, the routine's suggested links) must mean
// the WHOLE pull landed, not its first page: lastFullSyncAt is written only after the last page.

const TOKEN = "f2f2".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
let n = 0;
const open: HubDB[] = [];
afterEach(async () => {
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});
async function device() {
  const d = new HubDB(`full-sync-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}
const item = (id: string): Item => ({
  id, kind: "task", title: `Pretend ${id}`, links: [], areaId: "art", priority: 2, status: "open", createdAt: "2026-11-01", touchedAt: "2026-11-01",
});

it("a pull of several pages: lastFullSyncAt only after the last page (lastSyncedAt after each)", async () => {
  const server = new FakeSyncServer(TOKEN, { pageSize: 1 });
  const mac = await device();
  await mac.items.bulkAdd([item("p1"), item("p2"), item("p3")]);
  expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");

  const phone = await device();
  // A first sync, so firstPullDone is already true from an earlier day (as on her phone).
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
  await phone.syncMeta.delete("lastFullSyncAt");
  await mac.items.bulkPut([{ ...item("p1"), title: "Changed 1" }, { ...item("p2"), title: "Changed 2" }, { ...item("p3"), title: "Changed 3" }]);
  expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");

  const seen: { synced: unknown; full: unknown }[] = [];
  const watching: typeof server.fetch = async (input, init) => {
    seen.push({ synced: (await phone.syncMeta.get("lastSyncedAt"))?.value, full: (await phone.syncMeta.get("lastFullSyncAt"))?.value });
    return server.fetch(input, init);
  };
  const before = Date.now();
  expect((await syncOnce({ db: phone, fetch: watching })).kind).toBe("ok");
  expect(seen.length).toBeGreaterThanOrEqual(3); // three pages
  // Between pages: the first pages have landed, the whole pull hasn't.
  for (const s of seen.slice(1)) expect(s.full).toBeUndefined();
  expect((await phone.syncMeta.get("lastFullSyncAt"))?.value).toBeGreaterThanOrEqual(before);
  expect((await phone.items.get("p3"))?.title).toBe("Changed 3");
});
