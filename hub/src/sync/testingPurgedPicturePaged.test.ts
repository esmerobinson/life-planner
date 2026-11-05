import Dexie from "dexie";
import { vi } from "vitest";
import { db, HubDB } from "../data/db";
import { deleteItem, emptyBin } from "../data/repo";
import { pictureLine } from "../domain/page";
import type { FileRow, Item } from "../domain/types";
import { FakeSyncServer } from "./fakeServer";
import { saveSyncSettings, syncOnce } from "./engine";

// Testing session, second look at bug #2's fix (sync/engine.ts keepPicturesStillShown).
// What Esme would see: nothing on screen. But a picture she emptied from the Bin comes back
// to life on every device and on the server (taking space, and Empty Bin no longer wipes it),
// although no page shows it any more.
//
// Why: the Mac sends its pending changes in key order, so the emptied picture ("files")
// gets an earlier server number than its emptied page ("items"). When the phone's pull is
// split into pages between the two (the real server pages at 500 rows / 1 MB), the phone
// sees the emptied picture while its copy of the page is still only in the Bin, counts it
// as "still shown", and puts the image back with a newer stamp. The next page then empties
// the page, but the picture stays restored. Fictional data; fake token; in-memory server.

const TOKEN = "7e57".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
let clock = 1_800_000_000_000;
const open: HubDB[] = [];

beforeEach(async () => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  await Promise.all([db.items.clear(), db.goals.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear()]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

const picture = (id: string): FileRow => ({
  id, mime: "image/jpeg", data: "/9j/4AAQ", width: 1600, height: 1200, createdAt: "2026-10-28",
});
const task = (id: string, notes: string): Item => ({
  id, kind: "task", title: "Pretend sketchbook task", notes, links: [], areaId: "art", priority: 2,
  status: "open", createdAt: "2026-10-28", touchedAt: "2026-10-28",
});

it("Empty Bin on the Mac stays emptied when the phone's pull arrives in small pages", async () => {
  const server = new FakeSyncServer(TOKEN, { pageSize: 1 }); // forces the page split
  const mac = db;
  await saveSyncSettings(mac, { serverUrl: SERVER, token: TOKEN });
  const phone = new HubDB(`testing-paged-phone-${Math.random().toString(36).slice(2)}`);
  open.push(phone);
  await saveSyncSettings(phone, { serverUrl: SERVER, token: TOKEN });

  await mac.files.add(picture("pic1"));
  await mac.items.add(task("t1", `Pretend reference:\n${pictureLine("pic1")}`));
  await syncOnce({ db: mac, fetch: server.fetch });
  clock += 60_000;
  await deleteItem("t1", "2026-10-29");
  await syncOnce({ db: mac, fetch: server.fetch });
  await syncOnce({ db: phone, fetch: server.fetch });
  expect((await phone.items.get("t1"))!.status).toBe("deleted");
  expect((await phone.files.get("pic1"))!.data).toBe("/9j/4AAQ");

  // The Mac empties the Bin; nobody restores anything.
  clock += 60_000;
  await emptyBin("2026-10-29");
  await syncOnce({ db: mac, fetch: server.fetch });
  clock += 60_000;
  await syncOnce({ db: phone, fetch: server.fetch });
  await syncOnce({ db: mac, fetch: server.fetch });

  expect((await phone.items.get("t1"))!.status).toBe("purged");
  // The picture is emptied everywhere, as Empty Bin promises.
  expect((await phone.files.get("pic1"))!.data).toBe("");
  expect((await mac.files.get("pic1"))!.data).toBe("");
});
