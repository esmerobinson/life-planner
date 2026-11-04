import Dexie from "dexie";
import { vi } from "vitest";
import { db, HubDB } from "../data/db";
import { deleteItem, emptyBin } from "../data/repo";
import { pictureLine } from "../domain/page";
import type { FileRow, Item } from "../domain/types";
import { FakeSyncServer } from "./fakeServer";
import { saveSyncSettings, syncOnce } from "./engine";

// Testing session, bug (sync + Bin): a task comes back from the Bin on one device while the
// other device empties the Bin; the task wins (it is the later change) but its PICTURES stay
// emptied, everywhere. What Esme would see: the task is back with its words, but every
// picture on its page is a blank/missing image, on the Mac and the phone, and the picture
// can never be got back (the only copy, on the phone, was overwritten by the empty one).
//
// emptyBin writes a content-free tombstone for each picture on the emptied page
// (repo.ts purgePictures). The page row and the picture rows are separate last-write-wins
// rows, so a later edit/restore of the page on the other device wins for the page only.
// Fictional data only; fake token; in-memory fake server.

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

it("restoring a task from the Bin on the phone after the Mac emptied the Bin keeps its picture", async () => {
  const server = new FakeSyncServer(TOKEN);
  // The Mac is the app's own database (repo functions write there); the phone is a second one.
  const mac = db;
  await saveSyncSettings(mac, { serverUrl: SERVER, token: TOKEN });
  const phone = new HubDB(`testing-purge-phone-${Math.random().toString(36).slice(2)}`);
  open.push(phone);
  await saveSyncSettings(phone, { serverUrl: SERVER, token: TOKEN });

  // A task with a picture on its page, on both devices; then it is put in the Bin (synced).
  await mac.files.add(picture("pic1"));
  await mac.items.add(task("t1", `Pretend reference:\n${pictureLine("pic1")}`));
  await syncOnce({ db: mac, fetch: server.fetch });
  clock += 60_000;
  await deleteItem("t1", "2026-10-29");
  await syncOnce({ db: mac, fetch: server.fetch });
  await syncOnce({ db: phone, fetch: server.fetch });
  expect((await phone.items.get("t1"))!.status).toBe("deleted");
  expect((await phone.files.get("pic1"))!.data).toBe("/9j/4AAQ");

  // The Mac empties the Bin (the phone is offline).
  clock += 60_000;
  await emptyBin("2026-10-29");
  await syncOnce({ db: mac, fetch: server.fetch });

  // A minute later, the phone (still offline, it never saw the empty) restores the task
  // from its Bin (the same write as repo.ts restoreFromBin, on the phone's database):
  clock += 60_000;
  await phone.transaction("rw", phone.items, async () => {
    const item = (await phone.items.get("t1"))!;
    const { deletedAt: _d, ...rest } = item;
    await phone.items.put({ ...rest, status: "open", touchedAt: "2026-10-29" });
  });

  // Both come online.
  await syncOnce({ db: phone, fetch: server.fetch });
  await syncOnce({ db: mac, fetch: server.fetch });

  // The restore is the later change, so the task is back on both devices...
  const back = (await phone.items.get("t1"))!;
  expect(back.status).toBe("open");
  expect(back.notes).toContain(pictureLine("pic1"));
  expect((await mac.items.get("t1"))!.status).toBe("open");
  // ...and the picture its page shows must still be there (on the phone, and on the Mac).
  expect((await phone.files.get("pic1"))!.data).toBe("/9j/4AAQ");
  expect((await mac.files.get("pic1"))!.data).toBe("/9j/4AAQ");
});

it("editing a task on the phone after the Mac deleted it and emptied the Bin keeps its picture", async () => {
  const server = new FakeSyncServer(TOKEN);
  const mac = db;
  await saveSyncSettings(mac, { serverUrl: SERVER, token: TOKEN });
  const phone = new HubDB(`testing-purge-phone2-${Math.random().toString(36).slice(2)}`);
  open.push(phone);
  await saveSyncSettings(phone, { serverUrl: SERVER, token: TOKEN });

  await mac.files.add(picture("pic2"));
  await mac.items.add(task("t2", `Pretend layout:\n${pictureLine("pic2")}`));
  await syncOnce({ db: mac, fetch: server.fetch });
  await syncOnce({ db: phone, fetch: server.fetch });

  // On the Mac: delete, then empty the Bin. The phone is offline.
  clock += 60_000;
  await deleteItem("t2", "2026-10-29");
  await emptyBin("2026-10-29");
  await syncOnce({ db: mac, fetch: server.fetch });

  // Later, on the phone (offline), she edits the same task's title.
  clock += 60_000;
  await phone.items.update("t2", { title: "Pretend layout, second pass", touchedAt: "2026-10-29" });
  await syncOnce({ db: phone, fetch: server.fetch });
  await syncOnce({ db: mac, fetch: server.fetch });

  // Her edit is the later change: the task is live again, with the page that shows the picture.
  expect((await mac.items.get("t2"))).toMatchObject({ status: "open", title: "Pretend layout, second pass" });
  expect((await phone.items.get("t2"))!.notes).toContain(pictureLine("pic2"));
  // The picture on that page must not have been emptied.
  expect((await phone.files.get("pic2"))!.data).toBe("/9j/4AAQ");
});
