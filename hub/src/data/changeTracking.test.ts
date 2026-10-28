import Dexie from "dexie";
import { vi } from "vitest";
import { db, HubDB } from "./db";
import { applyUntracked, onLocalWrite } from "./changeTracking";
import {
  archiveItem, archiveItems, createGoal, createItem, itemToGoal, moveTo, removeFromToday, restoreItem,
  tickItem, toggleMilestone, untickItem, updateGoal, updateItem, updateItems,
} from "./repo";
import { restoreBackup } from "./backup";
import { importBacklog } from "../import/backlog";
import { importGoogleTasks } from "../import/googleTasks";
import googleFixture from "../import/__fixtures__/googleTasks.json";
import type { Goal, Item } from "../domain/types";

const today = "2026-10-28";
const item = (id: string, extra: Partial<Item> = {}): Item => ({
  id, kind: "task", title: `T ${id}`, links: [], areaId: "art", priority: 2,
  status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01", ...extra,
});
const goal = (id: string, extra: Partial<Goal> = {}): Goal => ({
  id, title: `G ${id}`, areaId: "art", kind: "practice", milestones: [{ id: "m", title: "x", done: false }],
  createdAt: "2026-10-01", ...extra,
});

let clock = 1_800_000_000_000;
beforeEach(async () => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  await db.items.clear();
  await db.goals.clear();
  await db.pending.clear();
});
afterEach(() => vi.restoreAllMocks());

async function pendingMap(d: HubDB = db) {
  const all = await d.pending.toArray();
  return new Map(all.map((p) => [`${p.table}/${p.id}`, p.updatedAt]));
}

/** Every row written has a fresh updatedAt and a matching pending entry. */
async function expectTracked(keys: string[], since: number) {
  const pending = await pendingMap();
  for (const key of keys) {
    const [table, id] = key.split("/") as ["items" | "goals", string];
    const row = await db[table].get(id);
    expect(row, key).toBeDefined();
    expect(row!.updatedAt, key).toBeGreaterThanOrEqual(since);
    expect(pending.get(key), key).toBe(row!.updatedAt);
  }
}

describe("v1 -> v2 migration", () => {
  it("keeps every existing row, stamps updatedAt and marks every row pending", async () => {
    const name = "migration-test";
    const v1 = new Dexie(name);
    v1.version(1).stores({ items: "id, status, areaId, goalId, due", goals: "id" });
    const rows = [item("a", { notes: "keep me" }), item("b", { status: "done", completedAt: "2026-10-02" })];
    await v1.table("items").bulkAdd(rows);
    await v1.table("goals").add(goal("g"));
    v1.close();

    const v2 = new HubDB(name);
    const items = await v2.items.orderBy("id").toArray();
    expect(items.map(({ updatedAt: _u, ...rest }) => rest)).toEqual(rows);
    expect(items.every((i) => i.updatedAt === clock)).toBe(true);
    const goals = await v2.goals.toArray();
    expect(goals.map(({ updatedAt: _u, ...rest }) => rest)).toEqual([goal("g")]);
    expect(goals[0]!.updatedAt).toBe(clock);
    const pending = await pendingMap(v2);
    expect(pending).toEqual(new Map([["items/a", clock], ["items/b", clock], ["goals/g", clock]]));
    expect(await v2.syncMeta.count()).toBe(0);
    v2.close();
    await Dexie.delete(name);
  });
});

describe("stamping every local write", () => {
  it("sets updatedAt = max(now, previous + 1), even when the clock goes backwards", async () => {
    await db.items.add(item("a"));
    expect((await db.items.get("a"))!.updatedAt).toBe(clock);
    clock -= 60_000; // the clock jumps back a minute
    await db.items.update("a", { title: "edited" });
    const after = (await db.items.get("a"))!;
    expect(after.updatedAt).toBe(1_800_000_000_001);
    await db.items.put({ ...after, title: "again" });
    expect((await db.items.get("a"))!.updatedAt).toBe(1_800_000_000_002);
    expect((await pendingMap()).get("items/a")).toBe(1_800_000_000_002);
  });

  it("ignores an updatedAt supplied by the caller (a stale copy cannot go backwards)", async () => {
    await db.items.add(item("a"));
    clock += 10;
    await db.items.put({ ...item("a"), updatedAt: 5 });
    expect((await db.items.get("a"))!.updatedAt).toBe(clock);
  });

  it("does not change the caller's object", async () => {
    const row = item("a");
    await db.items.add(row);
    expect(row).not.toHaveProperty("updatedAt");
  });

  it("repo writes all stamp and mark pending", async () => {
    const t0 = clock;
    const a = await createItem({ kind: "task", title: "A", areaId: "art", priority: 2 }, today);
    expect(a.updatedAt).toBe(t0);
    const g = await createGoal({ title: "G", areaId: "art", kind: "practice" }, today);
    await expectTracked([`items/${a.id}`, `goals/${g.id}`], t0);

    const steps: [string, () => Promise<unknown>][] = [
      ["updateItem", () => updateItem(a.id, { title: "A2" }, today)],
      ["tickItem", () => tickItem(a.id, today)],
      ["untickItem", () => untickItem(a.id, today)],
      ["moveTo today", () => moveTo(a.id, "today", today)],
      ["moveTo week", () => moveTo(a.id, "week", today)],
      ["removeFromToday", () => removeFromToday(a.id, today)],
      ["archiveItem", () => archiveItem(a.id, today)],
      ["restoreItem", () => restoreItem(a.id, today)],
      ["archiveItems", () => archiveItems([a.id], today)],
      ["updateItems", () => updateItems([a.id], { priority: 1 }, today)],
    ];
    for (const [name, step] of steps) {
      await db.pending.clear();
      clock += 1000;
      const before = (await db.items.get(a.id))!.updatedAt!;
      await step();
      const after = (await db.items.get(a.id))!.updatedAt!;
      expect(after, name).toBeGreaterThan(before);
      await expectTracked([`items/${a.id}`], clock);
    }

    for (const [name, step] of [
      ["updateGoal", () => updateGoal(g.id, { title: "G2" }, today)],
      ["toggleMilestone", () => toggleMilestone(g.id, "none")],
    ] as const) {
      await db.pending.clear();
      clock += 1000;
      await step();
      expect(name).toBeTruthy();
      await expectTracked([`goals/${g.id}`], clock);
    }

    await db.pending.clear();
    clock += 1000;
    const b = await createItem({ kind: "idea", title: "B", areaId: "inbox", priority: 3 }, today);
    await db.pending.clear();
    const made = await itemToGoal(b.id, "art", today);
    await expectTracked([`items/${b.id}`, `goals/${made.id}`], clock);
  });

  it("importBacklog and importGoogleTasks stamp and mark pending", async () => {
    await importBacklog("- [ ] Water the ferns\n- [ ] Email Sam\n", today);
    await importGoogleTasks(googleFixture, today);
    const items = await db.items.toArray();
    expect(items.length).toBeGreaterThan(2);
    await expectTracked(items.map((i) => `items/${i.id}`), clock);
  });

  it("restoreBackup (merge and replace) stamps restored rows and marks them pending", async () => {
    const file = {
      app: "life-hub", schema: 1, exportedOn: today,
      items: [item("r1", { updatedAt: 42 } as Partial<Item>), item("r2")],
      goals: [goal("rg")],
    };
    await restoreBackup(file, "merge");
    await expectTracked(["items/r1", "items/r2", "goals/rg"], clock);
    expect((await db.items.get("r1"))!.updatedAt).toBe(clock);

    await db.pending.clear();
    clock += 5000;
    await restoreBackup(file, "replace");
    await expectTracked(["items/r1", "items/r2", "goals/rg"], clock);
  });

  it("writes made while applying server changes are not stamped and not pending", async () => {
    await applyUntracked(db, async () => {
      await db.items.put({ ...item("remote"), updatedAt: 1234 });
      await db.goals.put({ ...goal("rg"), updatedAt: 99 });
    });
    expect((await db.items.get("remote"))!.updatedAt).toBe(1234);
    expect((await db.goals.get("rg"))!.updatedAt).toBe(99);
    expect(await db.pending.count()).toBe(0);
    // A local write straight after is tracked again.
    await db.items.update("remote", { title: "mine" });
    expect((await pendingMap()).get("items/remote")).toBe(clock);
  });

  it("tells listeners about local writes but not about remote applies", async () => {
    const seen = vi.fn();
    const off = onLocalWrite(db, seen);
    await applyUntracked(db, () => db.items.put({ ...item("x"), updatedAt: 1 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).not.toHaveBeenCalled();
    await db.items.add(item("y"));
    await vi.waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
    off();
  });
});
