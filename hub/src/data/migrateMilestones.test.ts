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
    const goalStamp = (await db.goals.get("g1"))!.updatedAt!;
    clock += 86_400_000; // migrated a day later
    expect(await migrateMilestones(TODAY)).toBe(1);

    const cleared = (await db.goals.get("g1"))!;
    expect(cleared.milestones).toEqual([]);
    const t1 = await db.items.get(milestoneTaskId("g1", "m1"));
    const t2 = await db.items.get(milestoneTaskId("g1", "m2"));
    expect(t1).toMatchObject({ kind: "task", title: "Outline all parts", goalId: "g1", areaId: "writing", milestone: true, status: "done", order: 0 });
    expect(t2).toMatchObject({ title: "Draft part 1", milestone: true, status: "open", order: 1 });
    // Tracked (waiting to sync) but with OLD stamps: the goal version's own, never "now".
    expect(t1!.updatedAt).toBe(goalStamp);
    expect(cleared.updatedAt).toBe(goalStamp + 1);
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

  // Review C-1: a device that migrates LATE (synced long ago, still holding the old goal with
  // milestones) must never win over edits made elsewhere since.
  it.each([
    ["the goal renamed", "rename"],
    ["the goal deleted", "delete"],
  ] as const)("a stale device migrating later never reverts edits made elsewhere (%s)", async (_n, goalEdit) => {
    const server = new FakeSyncServer(TOKEN);
    const device = async () => {
      const d = new HubDB(`stale-${++n}`);
      open.push(d);
      await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
      return d;
    };
    const mac = await device();
    const phone = await device();
    const legacy = goal({
      milestones: [
        { id: "m1", title: "Outline", done: false },
        { id: "m2", title: "Draft part 1", done: false },
        { id: "m3", title: "Edit", done: true },
      ],
    });
    await mac.goals.add(legacy);
    await syncOnce({ db: mac, fetch: server.fetch });
    await syncOnce({ db: phone, fetch: server.fetch }); // the phone's first pull, long ago
    expect((await phone.goals.get("g1"))!.milestones).toHaveLength(3);

    // Days later the Mac gets the new version, migrates and syncs.
    clock += 86_400_000;
    await migrateMilestones(TODAY, mac);
    await syncOnce({ db: mac, fetch: server.fetch });

    // Esme edits on the Mac: renames and ticks one step, bins another, edits the goal.
    clock += 60_000;
    const m1 = milestoneTaskId("g1", "m1");
    const m2 = milestoneTaskId("g1", "m2");
    await mac.items.update(m1, { title: "Outline, renamed", status: "done", completedAt: TODAY });
    await mac.items.update(m2, { status: "deleted", deletedAt: TODAY });
    if (goalEdit === "rename") await mac.goals.update("g1", { title: "Renamed on the Mac" });
    else await mac.goals.update("g1", { status: "deleted", deletedAt: TODAY });
    await syncOnce({ db: mac, fetch: server.fetch });

    // The phone opens the new version later (offline, before its sync): it migrates its stale copy.
    clock += 60_000;
    expect(await migrateMilestones("2026-10-30", phone)).toBe(1);
    for (let i = 0; i < 2; i++) {
      await syncOnce({ db: phone, fetch: server.fetch });
      await syncOnce({ db: mac, fetch: server.fetch });
    }

    for (const [where, get] of [
      ["server", async (t: string, id: string) => server.data(t, id)],
      ["mac", async (t: string, id: string) => (t === "items" ? mac.items.get(id) : mac.goals.get(id))],
      ["phone", async (t: string, id: string) => (t === "items" ? phone.items.get(id) : phone.goals.get(id))],
    ] as const) {
      expect(await get("items", m1), where).toMatchObject({ title: "Outline, renamed", status: "done" });
      expect(await get("items", m2), where).toMatchObject({ status: "deleted" });
      expect(await get("items", milestoneTaskId("g1", "m3")), where).toMatchObject({ title: "Edit", status: "done" });
      const g = (await get("goals", "g1")) as Record<string, unknown>;
      expect(g.milestones, where).toEqual([]);
      if (goalEdit === "rename") expect(g, where).toMatchObject({ title: "Renamed on the Mac" });
      else expect(g, where).toMatchObject({ status: "deleted" });
    }
    expect(await mac.items.count()).toBe(3);
    expect(await phone.items.count()).toBe(3);
    expect(await migrateMilestones(TODAY, mac)).toBe(0);
    expect(await migrateMilestones(TODAY, phone)).toBe(0);
  });
});
