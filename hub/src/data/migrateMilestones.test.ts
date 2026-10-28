import Dexie from "dexie";
import { vi } from "vitest";
import { db, HubDB } from "./db";
import { migrateMilestones } from "./migrateMilestones";
import { milestoneTaskId } from "../domain/milestones";
import { overallProgress } from "../domain/progress";
import type { Goal } from "../domain/types";
import { FakeSyncServer } from "../sync/fakeServer";
import { saveSyncSettings, syncOnce } from "../sync/engine";

const TODAY = "2026-10-28";
const TOKEN = "beef".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
let clock = 1_800_000_000_000;
let n = 0;
const open: HubDB[] = [];

const goal = (o: Partial<Goal> = {}): Goal => ({
  id: "g1", title: "Finish the pretend book", areaId: "writing", kind: "finite", deadline: "2026-12-31",
  milestones: [
    { id: "m1", title: "Outline all parts", done: true },
    { id: "m2", title: "Draft part 1", done: false },
  ],
  createdAt: "2026-09-01", ...o,
});

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

describe("migrateMilestones", () => {
  it("turns each milestone into a flagged linked task and empties the goal's list", async () => {
    await db.goals.add(goal());
    expect(await migrateMilestones(TODAY)).toBe(1);

    expect((await db.goals.get("g1"))!.milestones).toEqual([]);
    const t1 = await db.items.get(milestoneTaskId("g1", "m1"));
    const t2 = await db.items.get(milestoneTaskId("g1", "m2"));
    expect(t1).toMatchObject({ kind: "task", title: "Outline all parts", goalId: "g1", areaId: "writing", milestone: true, status: "done" });
    expect(t2).toMatchObject({ title: "Draft part 1", milestone: true, status: "open" });
    // Tracked writes: stamped and waiting to sync.
    expect(t1!.updatedAt).toBe(clock);
    expect(await db.pending.count()).toBe(3);
    // Progress now comes from the tasks.
    expect(overallProgress((await db.goals.get("g1"))!, (await db.items.toArray()), TODAY)).toMatchObject({ done: 1, total: 2 });
  });

  it("is idempotent: a second run writes nothing and never duplicates or reverts a task", async () => {
    await db.goals.add(goal());
    await migrateMilestones(TODAY);
    await db.items.update(milestoneTaskId("g1", "m2"), { status: "done", completedAt: TODAY });
    const before = await db.items.toArray();
    clock += 1000;
    expect(await migrateMilestones(TODAY)).toBe(0);
    expect(await db.items.toArray()).toEqual(before);
  });

  it("skips goals in the Bin, and goals with no milestones", async () => {
    await db.goals.bulkAdd([goal({ id: "binned", status: "deleted", deletedAt: TODAY }), goal({ id: "plain", milestones: [] })]);
    expect(await migrateMilestones(TODAY)).toBe(0);
    expect(await db.items.count()).toBe(0);
    expect((await db.goals.get("binned"))!.milestones).toHaveLength(2);
  });

  it("waits while sync is on and the first pull has not finished", async () => {
    await db.goals.add(goal());
    await db.syncMeta.bulkPut([{ key: "serverUrl", value: SERVER }, { key: "token", value: TOKEN }]);
    expect(await migrateMilestones(TODAY)).toBe(0);
    expect(await db.items.count()).toBe(0);
    await db.syncMeta.put({ key: "firstPullDone", value: true });
    expect(await migrateMilestones(TODAY)).toBe(1);
  });

  it("two devices converting the same goal converge on the same rows through sync", async () => {
    const server = new FakeSyncServer(TOKEN);
    const device = async () => {
      const d = new HubDB(`ms-${++n}`);
      open.push(d);
      await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
      return d;
    };
    const mac = await device();
    const phone = await device();
    // Both hold the same goal (e.g. restored from the same backup), neither has synced.
    await mac.goals.add(goal());
    await phone.goals.add(goal());
    await syncOnce({ db: mac, fetch: server.fetch });
    await syncOnce({ db: phone, fetch: server.fetch });

    await migrateMilestones(TODAY, mac);
    clock += 5000;
    await migrateMilestones("2026-10-29", phone);
    for (let i = 0; i < 2; i++) {
      await syncOnce({ db: mac, fetch: server.fetch });
      await syncOnce({ db: phone, fetch: server.fetch });
    }

    const strip = (rows: { updatedAt?: number }[]) => rows.map(({ updatedAt: _u, ...r }) => r);
    const macItems = strip(await mac.items.orderBy("id").toArray());
    const phoneItems = strip(await phone.items.orderBy("id").toArray());
    expect(macItems).toHaveLength(2);
    expect(phoneItems).toEqual(macItems);
    expect((await mac.goals.get("g1"))!.milestones).toEqual([]);
    expect((await phone.goals.get("g1"))!.milestones).toEqual([]);
    expect(await migrateMilestones(TODAY, mac)).toBe(0);
    expect(await migrateMilestones(TODAY, phone)).toBe(0);
  });
});
