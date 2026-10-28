import Dexie from "dexie";
import { vi } from "vitest";
import { db, HubDB } from "../data/db";
import { restoreBackup } from "../data/backup";
import type { Item } from "../domain/types";
import { FakeSyncServer } from "./fakeServer";
import { saveSyncSettings, syncOnce } from "./engine";

// Two devices that hold the SAME rows (stable ids from a transfer or backup file): the
// one that joins sync later must never revert edits the other made in the meantime.

const TOKEN = "d00d".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
let clock = 1_800_000_000_000;
let n = 0;
const open: HubDB[] = [];

beforeEach(async () => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  await db.items.clear();
  await db.goals.clear();
  await db.pending.clear();
  await db.syncMeta.clear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

const item = (id: string, extra: Partial<Item> = {}): Item => ({
  id, kind: "task", title: `T ${id}`, links: [], areaId: "art", priority: 2,
  status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01", ...extra,
});

async function synced(name: string) {
  const d = new HubDB(name);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}

describe("a second device holding the same rows", () => {
  it("a device that upgrades from v1 later does not beat edits made since on the other device", async () => {
    const server = new FakeSyncServer(TOKEN);
    // Both devices had the same row before sync existed.
    const stale = item("shared", { title: "old title", touchedAt: "2026-10-01" });
    const mac = await synced(`mac-${++n}`);
    await mac.items.add(stale);
    await syncOnce({ db: mac, fetch: server.fetch });
    clock += 60_000;
    await mac.items.update("shared", { title: "edited on the Mac", status: "archived" });
    await syncOnce({ db: mac, fetch: server.fetch });

    // The phone still has the v1 database with the old copy; it upgrades now (later).
    const name = `phone-${++n}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({ items: "id, status, areaId, goalId, due", goals: "id" });
    await v1.table("items").add(stale);
    v1.close();
    clock += 86_400_000; // a day later
    const phone = await synced(name);
    await syncOnce({ db: phone, fetch: server.fetch });

    expect(server.data("items", "shared")).toMatchObject({ title: "edited on the Mac", status: "archived" });
    expect(await phone.items.get("shared")).toMatchObject({ title: "edited on the Mac", status: "archived" });
    await syncOnce({ db: mac, fetch: server.fetch });
    expect(await mac.items.get("shared")).toMatchObject({ title: "edited on the Mac", status: "archived" });
    expect(await phone.pending.count()).toBe(0);
  });

  it("Merge of the same file on a device that has not synced yet never reverts newer server rows", async () => {
    const server = new FakeSyncServer(TOKEN);
    const file = {
      app: "life-hub", schema: 1, exportedOn: "2026-10-28",
      items: [item("t1", { title: "from the file" }), item("t2", { title: "also from the file" })],
      goals: [],
    };
    const mac = await synced(`mac-${++n}`);
    await mac.items.bulkAdd(file.items);
    await syncOnce({ db: mac, fetch: server.fetch });
    clock += 60_000;
    await mac.items.update("t1", { title: "renamed on the Mac" });
    await syncOnce({ db: mac, fetch: server.fetch });

    // The other device (the app's own database here) merges the same file before syncing.
    await restoreBackup(file, "merge");
    clock += 60_000;
    await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
    await syncOnce({ db, fetch: server.fetch });

    expect(server.data("items", "t1")!.title).toBe("renamed on the Mac");
    expect((await db.items.get("t1"))!.title).toBe("renamed on the Mac");
    expect((await db.items.get("t2"))!.title).toBe("also from the file");
    expect(await db.items.count()).toBe(2);
  });
});
