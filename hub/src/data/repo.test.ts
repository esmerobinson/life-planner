import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "./db";
import {
  createItem, createGoal, tickItem, untickItem, moveTo, removeFromToday,
  archiveItem, restoreItem, listItems, toggleMilestone, updateItems,
} from "./repo";

const today = "2026-10-27";
const base = { kind: "task" as const, title: "t", areaId: "writing" as const, priority: 2 as const };

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

describe("repo", () => {
  it("tick sets done and completedAt; second tick changes nothing", async () => {
    const it1 = await createItem(base, "2026-10-01");
    await tickItem(it1.id, "2026-10-02");
    await tickItem(it1.id, "2026-10-05");
    const got = await db.items.get(it1.id);
    expect(got?.status).toBe("done");
    expect(got?.completedAt).toBe("2026-10-02");
  });

  it("untick returns to open and clears completedAt", async () => {
    const it1 = await createItem(base, today);
    await tickItem(it1.id, today);
    await untickItem(it1.id, today);
    const got = await db.items.get(it1.id);
    expect(got?.status).toBe("open");
    expect(got?.completedAt).toBeUndefined();
  });

  it("moveTo today/tomorrow/week set the right fields", async () => {
    const it1 = await createItem({ ...base, hiddenOn: today }, today);
    await moveTo(it1.id, "today", today);
    let got = await db.items.get(it1.id);
    expect(got?.pinnedDate).toBe(today);
    expect(got?.hiddenOn).toBeUndefined();
    await moveTo(it1.id, "tomorrow", today);
    got = await db.items.get(it1.id);
    expect(got?.pinnedDate).toBe("2026-10-28");
    await moveTo(it1.id, "week", today);
    got = await db.items.get(it1.id);
    expect(got?.pinnedDate).toBeUndefined();
    expect(got?.weekOf).toBe("2026-10-26");
  });

  it("moveTo week sets weekOf and hiddenOn today", async () => {
    const it1 = await createItem({ ...base, pinnedDate: today }, today);
    await moveTo(it1.id, "week", today);
    const got = await db.items.get(it1.id);
    expect(got?.weekOf).toBe("2026-10-26");
    expect(got?.hiddenOn).toBe(today);
    expect(got?.pinnedDate).toBeUndefined();
    await moveTo(it1.id, "tomorrow", today);
    expect((await db.items.get(it1.id))?.hiddenOn).toBeUndefined();
  });

  it("removeFromToday hides and unpins", async () => {
    const it1 = await createItem(base, today);
    await moveTo(it1.id, "today", today);
    await removeFromToday(it1.id, today);
    const got = await db.items.get(it1.id);
    expect(got?.hiddenOn).toBe(today);
    expect(got?.pinnedDate).toBeUndefined();
  });

  it("archive hides from default listItems but restore brings it back", async () => {
    const it1 = await createItem(base, today);
    await archiveItem(it1.id, today);
    expect(await listItems()).toHaveLength(0);
    expect(await listItems({ status: "archived" })).toHaveLength(1);
    await restoreItem(it1.id, today);
    const list = await listItems();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("open");
  });

  it("createGoal finite without deadline throws", async () => {
    await expect(
      createGoal({ title: "g", areaId: "art", kind: "finite" }, today),
    ).rejects.toThrow("finite goals need a deadline");
  });

  it("listItems filters by area and goal", async () => {
    const g = await createGoal({ title: "g", areaId: "art", kind: "practice" }, today);
    await createItem({ ...base, areaId: "art", goalId: g.id }, today);
    await createItem({ ...base, areaId: "body" }, today);
    expect(await listItems({ areaId: "art" })).toHaveLength(1);
    expect(await listItems({ goalId: g.id })).toHaveLength(1);
    expect(await listItems()).toHaveLength(2);
  });

  it("restore of an item done before archiving returns it to done with original completedAt", async () => {
    const it1 = await createItem(base, "2026-10-01");
    await tickItem(it1.id, "2026-10-02");
    await archiveItem(it1.id, "2026-10-03");
    await restoreItem(it1.id, "2026-10-04");
    const got = await db.items.get(it1.id);
    expect(got?.status).toBe("done");
    expect(got?.completedAt).toBe("2026-10-02");
  });

  it("restore of an item archived while open returns it to open", async () => {
    const it1 = await createItem(base, today);
    await archiveItem(it1.id, today);
    await restoreItem(it1.id, today);
    expect((await db.items.get(it1.id))?.status).toBe("open");
  });

  it("two concurrent toggleMilestone calls flip twice (back to original)", async () => {
    const g = await createGoal(
      { title: "g", areaId: "art", kind: "finite", deadline: "2026-12-01",
        milestones: [{ id: "m1", title: "a", done: false }] }, today);
    await Promise.all([toggleMilestone(g.id, "m1"), toggleMilestone(g.id, "m1")]);
    expect((await db.goals.get(g.id))?.milestones[0].done).toBe(false);
  });

  it("two concurrent tickItem calls leave a single consistent done item", async () => {
    const it1 = await createItem(base, "2026-10-01");
    await Promise.all([tickItem(it1.id, "2026-10-02"), tickItem(it1.id, "2026-10-03")]);
    const got = await db.items.get(it1.id);
    expect(got?.status).toBe("done");
    expect(got?.completedAt).toBe("2026-10-02");
    expect(await db.items.count()).toBe(1);
  });

  it("toggleMilestone flips done", async () => {
    const g = await createGoal(
      { title: "g", areaId: "art", kind: "finite", deadline: "2026-12-01",
        milestones: [{ id: "m1", title: "a", done: false }] }, today);
    await toggleMilestone(g.id, "m1");
    expect((await db.goals.get(g.id))?.milestones[0].done).toBe(true);
    await toggleMilestone(g.id, "m1");
    expect((await db.goals.get(g.id))?.milestones[0].done).toBe(false);
  });
});

describe("updateItems", () => {
  it("updateItems changes all given ids in one transaction, ignores unknown ids, and never changes status/tags/source", async () => {
    const a = await createItem({ ...base, areaId: "inbox", tags: ["x"], source: { kind: "backlog", key: "k1" } }, "2026-10-01");
    const b = await createItem({ ...base, areaId: "inbox" }, "2026-10-01");
    await db.items.update(b.id, { status: "done", completedAt: "2026-10-02" });
    const spy = vi.spyOn(db, "transaction");
    await updateItems([a.id, b.id, "nope"], { areaId: "art", priority: 1 }, today);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    const ga = (await db.items.get(a.id))!;
    const gb = (await db.items.get(b.id))!;
    expect(ga).toMatchObject({ areaId: "art", priority: 1, touchedAt: today, tags: ["x"], status: "open", source: { kind: "backlog", key: "k1" } });
    expect(gb).toMatchObject({ areaId: "art", priority: 1, touchedAt: today, status: "done", completedAt: "2026-10-02" });
    expect(await db.items.count()).toBe(2);
  });

  it("updateItems rolls back everything if one write fails", async () => {
    const a = await createItem({ ...base, areaId: "inbox" }, "2026-10-01");
    const b = await createItem({ ...base, areaId: "inbox" }, "2026-10-01");
    const orig = db.items.update.bind(db.items);
    let calls = 0;
    const spy = vi.spyOn(db.items, "update").mockImplementation(((...args: Parameters<typeof orig>) => {
      calls++;
      if (calls === 2) return Promise.reject(new Error("boom"));
      return orig(...args);
    }) as typeof db.items.update);
    await expect(updateItems([a.id, b.id], { areaId: "art" }, today)).rejects.toThrow();
    spy.mockRestore();
    expect(await db.items.get(a.id)).toMatchObject({ areaId: "inbox", touchedAt: "2026-10-01" });
    expect(await db.items.get(b.id)).toMatchObject({ areaId: "inbox", touchedAt: "2026-10-01" });
  });
});
