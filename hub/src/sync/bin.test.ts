import Dexie from "dexie";
import { vi } from "vitest";
import { db, HubDB } from "../data/db";
import { createItem, deleteItem, emptyBin, listBin } from "../data/repo";
import { FakeSyncServer } from "./fakeServer";
import { saveSyncSettings, syncOnce } from "./engine";

// The Bin through sync: a deleted row and an emptied (purged) tombstone travel like any
// other change, pass the other device's validator, and never come back to life.

const TOKEN = "b1b1".padEnd(64, "0"); // fake
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
  await db.quarantine.clear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

async function otherDevice() {
  const d = new HubDB(`bin-phone-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}

describe("the Bin through sync", () => {
  it("delete, then empty: the other device gets the deleted row, then the content-free tombstone, and quarantines nothing", async () => {
    const server = new FakeSyncServer(TOKEN);
    await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
    const it1 = await createItem(
      { kind: "task", title: "Made-up errand", notes: "a note", areaId: "inbox", priority: 2 },
      "2026-10-20",
    );
    await syncOnce({ db, fetch: server.fetch });
    const phone = await otherDevice();
    await syncOnce({ db: phone, fetch: server.fetch });
    expect((await phone.items.get(it1.id))!.title).toBe("Made-up errand");

    clock += 60_000;
    await deleteItem(it1.id, "2026-10-28");
    await syncOnce({ db, fetch: server.fetch });
    await syncOnce({ db: phone, fetch: server.fetch });
    expect(await phone.items.get(it1.id)).toMatchObject({ status: "deleted", deletedAt: "2026-10-28" });
    expect(await phone.quarantine.count()).toBe(0);

    clock += 60_000;
    expect(await emptyBin("2026-10-28")).toBe(1);
    await syncOnce({ db, fetch: server.fetch });
    expect(server.data("items", it1.id)).toMatchObject({ status: "purged", title: "" });
    expect(server.data("items", it1.id)!.notes).toBeUndefined();
    await syncOnce({ db: phone, fetch: server.fetch });
    const onPhone = (await phone.items.get(it1.id))!;
    expect(onPhone).toMatchObject({ status: "purged", title: "", links: [] });
    expect(onPhone.notes).toBeUndefined();
    expect(await phone.quarantine.count()).toBe(0);
    expect(await phone.pending.count()).toBe(0);
    expect(await db.pending.count()).toBe(0);
    expect(await listBin()).toEqual([]);
  });
});
