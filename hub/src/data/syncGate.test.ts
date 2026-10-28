import { vi } from "vitest";
import { db } from "./db";
import { restoreBackup } from "./backup";
import { REPLACE_OFF_WHILE_SYNCING, WAITING_FIRST_SYNC } from "./syncGate";
import { importBacklog } from "../import/backlog";
import { importGoogleTasks } from "../import/googleTasks";
import googleFixture from "../import/__fixtures__/googleTasks.json";
import { FakeSyncServer } from "../sync/fakeServer";
import { saveSyncSettings, syncOnce } from "../sync/engine";
import type { Item } from "../domain/types";

const TOKEN = "facade".padEnd(64, "0"); // fake
const item = (id: string): Item => ({
  id, kind: "task", title: `T ${id}`, links: [], areaId: "art", priority: 2,
  status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01",
});
const file = { app: "life-hub", schema: 1, exportedOn: "2026-10-28", items: [item("f1")], goals: [] };

/** A stand-in for navigator.locks that serialises callbacks per name and records names. */
class FakeLocks {
  names: string[] = [];
  private chains = new Map<string, Promise<unknown>>();
  request(name: string, cb: () => Promise<unknown>) {
    this.names.push(name);
    const run = (this.chains.get(name) ?? Promise.resolve()).then(() => cb());
    this.chains.set(name, run.catch(() => undefined));
    return run;
  }
}

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
  await db.pending.clear();
  await db.syncMeta.clear();
});
afterEach(() => {
  delete (navigator as { locks?: unknown }).locks;
  vi.restoreAllMocks();
});

describe("restores and imports while sync is on", () => {
  it("with sync off, Merge, Replace and the importers all work", async () => {
    await expect(restoreBackup(file, "merge")).resolves.toBeTruthy();
    await expect(restoreBackup(file, "replace")).resolves.toBeTruthy();
    await expect(importBacklog("- [ ] Water the ferns\n", "2026-10-28")).resolves.toBeTruthy();
  });

  it("before the first full pull, Merge and both importers are refused; Replace is always refused", async () => {
    await db.syncMeta.bulkPut([{ key: "serverUrl", value: "https://sync.example.test" }, { key: "token", value: TOKEN }]);
    await expect(restoreBackup(file, "merge")).rejects.toThrow(WAITING_FIRST_SYNC);
    await expect(restoreBackup(file, "replace")).rejects.toThrow(REPLACE_OFF_WHILE_SYNCING);
    await expect(importBacklog("- [ ] Water the ferns\n", "2026-10-28")).rejects.toThrow(WAITING_FIRST_SYNC);
    await expect(importGoogleTasks(googleFixture, "2026-10-28")).rejects.toThrow(WAITING_FIRST_SYNC);
    expect(await db.items.count()).toBe(0);
  });

  it("after the first full pull, Merge and imports work again, Replace stays off", async () => {
    await saveSyncSettings(db, { serverUrl: "https://sync.example.test", token: TOKEN });
    const server = new FakeSyncServer(TOKEN);
    expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
    await expect(restoreBackup(file, "merge")).resolves.toMatchObject({ addedItems: 1 });
    await expect(importBacklog("- [ ] Water the ferns\n", "2026-10-28")).resolves.toMatchObject({ added: 1 });
    await expect(restoreBackup(file, "replace")).rejects.toThrow(REPLACE_OFF_WHILE_SYNCING);
  });

  it("sync waiting for the passphrase still counts as on", async () => {
    await db.syncMeta.bulkPut([{ key: "serverUrl", value: "https://sync.example.test" }, { key: "needsPassphrase", value: true }]);
    await expect(restoreBackup(file, "replace")).rejects.toThrow(REPLACE_OFF_WHILE_SYNCING);
  });
});

describe("the sync lock", () => {
  it("restores take the same Web Lock as sync runs, so they never overlap", async () => {
    const locks = new FakeLocks();
    Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
    await saveSyncSettings(db, { serverUrl: "https://sync.example.test", token: TOKEN });
    await db.syncMeta.put({ key: "firstPullDone", value: true });
    const server = new FakeSyncServer(TOKEN);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const order: string[] = [];
    const slow: typeof fetch = async (input, init) => {
      order.push("sync request");
      await gate;
      const res = await server.fetch(input, init);
      order.push("sync done");
      return res;
    };
    const run = syncOnce({ db, fetch: slow });
    await vi.waitFor(() => expect(order).toEqual(["sync request"]));
    const restore = restoreBackup(file, "merge").then(() => order.push("restore"));
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(["sync request"]); // the restore waits for the run
    release();
    await Promise.all([run, restore]);
    expect(order).toEqual(["sync request", "sync done", "restore"]);
    expect(new Set(locks.names)).toEqual(new Set(["esmeworld-sync:life-hub"]));
  });
});
