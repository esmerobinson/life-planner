import Dexie from "dexie";
import { vi } from "vitest";
import { db, HubDB } from "../data/db";
import { exportBackup, restoreBackup } from "../data/backup";
import { archiveItem, moveTo, pinTo, restoreItem, tickItem, untickItem, updateItem } from "../data/repo";
import type { Item } from "../domain/types";
import { FakeSyncServer } from "./fakeServer";
import { saveSyncSettings, syncOnce } from "./engine";

// "What I did" notes (2026-11-19) are a new to-do field, `did`. They sync like any to-do field
// (in clear, like every to-do: NOT end-to-end encrypted). An app version from before them keeps
// them: its validator ignores fields it doesn't know and every write it makes spreads the row.
// That older version's writes are simulated with the repo's existing writes (tick, untick, edit,
// move, pin, archive, restore), which it had too. Made-up words only.

const TOKEN = "d1d0".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
const DAY = "2026-11-18";
const DID = [{ id: "e1", on: DAY, note: "Pretend wrote the opening", files: [{ name: "opening.docx", folder: "~/Desktop/Writing" }] }];
let clock = 1_800_000_000_000;
let n = 0;
const open: HubDB[] = [];

beforeEach(async () => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  await Promise.all([db.items.clear(), db.goals.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear()]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

async function mac() {
  const d = new HubDB(`did-mac-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}

const todo: Item = {
  id: "t1", kind: "task", title: "Pretend chapter", links: [], areaId: "writing", priority: 2,
  status: "done", completedAt: DAY, createdAt: "2026-11-01", touchedAt: DAY, did: DID,
};

it("a note and its file records reach the other device, and survive its (older-style) edits on the way back", async () => {
  const server = new FakeSyncServer(TOKEN);
  const m = await mac();
  await m.items.put(todo);
  expect((await syncOnce({ db: m, fetch: server.fetch })).kind).toBe("ok");

  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  clock += 1000;
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  expect((await db.items.get("t1"))!.did).toEqual(DID);

  for (const write of [
    () => untickItem("t1", DAY),
    () => updateItem("t1", { title: "Pretend chapter, renamed" }, DAY),
    () => pinTo("t1", "2026-11-20", DAY),
    () => moveTo("t1", "week", DAY),
    () => updateItem("t1", { areaId: "art" }, DAY),
    () => tickItem("t1", DAY),
    () => archiveItem("t1", DAY),
    () => restoreItem("t1", DAY),
  ]) {
    clock += 1000;
    await write();
  }
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  clock += 1000;
  expect((await syncOnce({ db: m, fetch: server.fetch })).kind).toBe("ok");
  const back = (await m.items.get("t1"))!;
  expect(back.title).toBe("Pretend chapter, renamed");
  expect(back.did).toEqual(DID);
});

it("a backup keeps the notes, and restoring it brings them back", async () => {
  await db.items.put(todo);
  const file = await exportBackup(DAY);
  expect(JSON.stringify(file)).toContain("Pretend wrote the opening");
  await db.items.clear();
  await restoreBackup(file, "replace");
  expect((await db.items.get("t1"))!.did).toEqual(DID);
});
