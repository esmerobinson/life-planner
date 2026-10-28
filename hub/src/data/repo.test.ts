import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "./db";
import {
  createItem, createGoal, tickItem, untickItem, moveTo, removeFromToday,
  archiveItem, restoreItem, listItems, toggleMilestone, updateItems, updateItem, updateGoal, archiveItems,
  itemToGoal,
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

describe("updateItem", () => {
  it("sets a due date and touches the item", async () => {
    const a = await createItem({ ...base, due: "2026-10-01" }, "2026-10-01");
    await updateItem(a.id, { due: "2026-11-05" }, today);
    const got = (await db.items.get(a.id))!;
    expect(got.due).toBe("2026-11-05");
    expect(got.touchedAt).toBe(today);
  });

  it("clears the due date when due is explicitly undefined, keeping the other fields", async () => {
    const a = await createItem({ ...base, due: "2026-10-01", tags: ["x"] }, "2026-10-01");
    await updateItem(a.id, { due: undefined }, today);
    const got = (await db.items.get(a.id))!;
    expect("due" in got).toBe(false);
    expect(got.tags).toEqual(["x"]);
    expect(got.status).toBe("open");
    expect(got.touchedAt).toBe(today);
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

  it("updateItems copies only areaId, goalId, priority and due, even if a caller casts others in", async () => {
    const a = await createItem({ ...base, areaId: "inbox", source: { kind: "backlog", key: "k1" } }, "2026-10-01");
    const sneaky = { areaId: "tech", status: "done", source: { kind: "manual", key: "x" }, title: "hijack" };
    await updateItems([a.id], sneaky as never, today);
    const got = (await db.items.get(a.id))!;
    expect(got).toMatchObject({
      areaId: "tech", status: "open", title: "t", touchedAt: today, source: { kind: "backlog", key: "k1" },
    });
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

describe("updateItem clearing fields", () => {
  it("clears due, recur, pinnedDate and hiddenOn when they are passed explicitly as undefined", async () => {
    const it1 = await createItem(
      { ...base, due: "2026-11-01", recur: ["mon"], pinnedDate: "2026-10-28", hiddenOn: "2026-10-28", notes: "keep" },
      "2026-10-01",
    );
    await updateItem(
      it1.id,
      { kind: "idea", due: undefined, recur: undefined, pinnedDate: undefined, hiddenOn: undefined },
      "2026-10-20",
    );
    const got = (await db.items.get(it1.id))!;
    expect(got).toMatchObject({ kind: "idea", notes: "keep", touchedAt: "2026-10-20" });
    for (const k of ["due", "recur", "pinnedDate", "hiddenOn"] as const) expect(k in got).toBe(false);
  });

  it("leaves fields alone when they are not in the patch", async () => {
    const it1 = await createItem({ ...base, due: "2026-11-01", recur: ["mon"] }, "2026-10-01");
    await updateItem(it1.id, { kind: "idea" }, "2026-10-20");
    expect(await db.items.get(it1.id)).toMatchObject({ kind: "idea", due: "2026-11-01", recur: ["mon"] });
  });
});

describe("itemToGoal", () => {
  it("makes a practice goal from the item and archives the item with a note, in one transaction", async () => {
    const it1 = await createItem({ ...base, title: "Learn pottery", areaId: "inbox", notes: "Some detail" }, "2026-10-01");
    const spy = vi.spyOn(db, "transaction");
    const goal = await itemToGoal(it1.id, "art", "2026-10-20");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(goal).toMatchObject({ title: "Learn pottery", areaId: "art", kind: "practice", notes: "Some detail", milestones: [], createdAt: "2026-10-20" });
    expect(goal.deadline).toBeUndefined();
    expect(await db.goals.get(goal.id)).toEqual(goal);
    expect(await db.items.get(it1.id)).toMatchObject({
      status: "archived", touchedAt: "2026-10-20", title: "Learn pottery",
      notes: "Some detail\nBecame a goal: Learn pottery",
    });
    expect(await db.items.count()).toBe(1);
  });

  it("uses admin when the area is the inbox, and works for an item with no notes", async () => {
    const it1 = await createItem({ ...base, title: "Vague thing", areaId: "inbox" }, "2026-10-01");
    const goal = await itemToGoal(it1.id, "inbox", "2026-10-20");
    expect(goal.areaId).toBe("admin");
    expect(goal.notes).toBeUndefined();
    expect((await db.items.get(it1.id))!.notes).toBe("Became a goal: Vague thing");
  });

  it("rolls back the goal if archiving the item fails", async () => {
    const it1 = await createItem({ ...base, title: "Keep me", areaId: "inbox" }, "2026-10-01");
    const spy = vi.spyOn(db.items, "update").mockRejectedValue(new Error("boom"));
    await expect(itemToGoal(it1.id, "art", "2026-10-20")).rejects.toThrow();
    spy.mockRestore();
    expect(await db.goals.count()).toBe(0);
    expect(await db.items.get(it1.id)).toMatchObject({ status: "open", title: "Keep me" });
  });

  it("rejects a missing item and an unknown area, writing nothing", async () => {
    await expect(itemToGoal("nope", "art", today)).rejects.toThrow();
    const it1 = await createItem({ ...base, areaId: "inbox" }, "2026-10-01");
    await expect(itemToGoal(it1.id, "nowhere" as never, today)).rejects.toThrow();
    expect(await db.goals.count()).toBe(0);
    expect((await db.items.get(it1.id))!.status).toBe("open");
  });
});

describe("archiveItems", () => {
  it("archives every given item in one transaction and returns how many", async () => {
    const a = await createItem(base, "2026-10-01");
    const b = await createItem({ ...base, areaId: "art" }, "2026-10-01");
    const keep = await createItem(base, "2026-10-01");
    const spy = vi.spyOn(db, "transaction");
    const n = await archiveItems([a.id, b.id], "2026-10-20");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(n).toBe(2);
    expect(await db.items.get(a.id)).toMatchObject({ status: "archived", touchedAt: "2026-10-20", title: "t" });
    expect(await db.items.get(b.id)).toMatchObject({ status: "archived", areaId: "art" });
    expect(await db.items.get(keep.id)).toMatchObject({ status: "open", touchedAt: "2026-10-01" });
    expect(await db.items.count()).toBe(3);
  });

  it("ignores unknown ids silently and handles an empty list", async () => {
    const a = await createItem(base, "2026-10-01");
    expect(await archiveItems(["nope", a.id, "nada"], today)).toBe(1);
    expect(await archiveItems([], today)).toBe(0);
    expect((await db.items.get(a.id))!.status).toBe("archived");
  });

  it("rolls back everything if one write fails", async () => {
    const a = await createItem(base, "2026-10-01");
    const b = await createItem(base, "2026-10-01");
    const real = db.items.update.bind(db.items);
    let calls = 0;
    const spy = vi.spyOn(db.items, "update").mockImplementation(((...args: Parameters<typeof real>) => {
      calls++;
      if (calls === 2) throw new Error("disk full");
      return real(...args);
    }) as never);
    await expect(archiveItems([a.id, b.id], today)).rejects.toThrow();
    spy.mockRestore();
    expect((await db.items.get(a.id))!.status).toBe("open");
    expect((await db.items.get(b.id))!.status).toBe("open");
  });

  it("archived items show in their area's archive list and can be restored", async () => {
    const a = await createItem({ ...base, areaId: "art" }, "2026-10-01");
    await archiveItems([a.id], today);
    expect((await listItems({ status: "archived", areaId: "art" })).map((i) => i.id)).toEqual([a.id]);
    expect(await listItems({ status: "open", areaId: "art" })).toEqual([]);
    await restoreItem(a.id, today);
    expect((await db.items.get(a.id))!.status).toBe("open");
    expect(await listItems({ status: "archived", areaId: "art" })).toEqual([]);
  });
});

describe("updateGoal", () => {
  const seed = () =>
    createGoal(
      {
        title: "Old", areaId: "art", kind: "finite", deadline: "2026-12-31", monthlyTarget: 3,
        milestones: [{ id: "m1", title: "one", done: true }], why: "because", cadence: "Weekly: 2",
        notes: "n", source: { kind: "obsidian", key: "obsidian:goal:old" },
      },
      today,
    );

  it("changes only title, area, deadline and monthly target, in one transaction", async () => {
    const g = await seed();
    const spy = vi.spyOn(db, "transaction");
    await updateGoal(g.id, { title: "  New  ", areaId: "body", deadline: "2027-01-31", monthlyTarget: 5 }, "2026-11-01");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(await db.goals.get(g.id)).toEqual({
      ...g, title: "New", areaId: "body", deadline: "2027-01-31", monthlyTarget: 5,
    });
  });

  it("never touches milestones, source, why, cadence or notes, even if passed", async () => {
    const g = await seed();
    await updateGoal(g.id, { title: "X", milestones: [], source: undefined, why: "hacked" } as never, today);
    const got = (await db.goals.get(g.id))!;
    expect(got.milestones).toEqual(g.milestones);
    expect(got.source).toEqual(g.source);
    expect(got.why).toBe("because");
  });

  it("leaves fields that are not in the patch alone", async () => {
    const g = await seed();
    await updateGoal(g.id, { title: "Only title" }, today);
    expect(await db.goals.get(g.id)).toEqual({ ...g, title: "Only title" });
  });

  it("clears the monthly target and the deadline of a practice goal when set to undefined", async () => {
    const p = await createGoal({ title: "p", areaId: "art", kind: "practice", deadline: "2026-12-01", monthlyTarget: 2 }, today);
    await updateGoal(p.id, { deadline: undefined, monthlyTarget: undefined }, today);
    const got = (await db.goals.get(p.id))!;
    expect(got.deadline).toBeUndefined();
    expect(got.monthlyTarget).toBeUndefined();
  });

  it.each([
    ["blank title", { title: "   " }],
    ["inbox area", { areaId: "inbox" }],
    ["unknown area", { areaId: "nowhere" }],
    ["finite goal losing its deadline", { deadline: undefined }],
    ["impossible deadline", { deadline: "2026-02-30" }],
    ["monthly target 0", { monthlyTarget: 0 }],
    ["monthly target 1.5", { monthlyTarget: 1.5 }],
  ])("rejects %s and changes nothing", async (_n, patch) => {
    const g = await seed();
    await expect(updateGoal(g.id, patch as never, today)).rejects.toThrow();
    expect(await db.goals.get(g.id)).toEqual(g);
  });

  it("rejects a goal that does not exist", async () => {
    await expect(updateGoal("nope", { title: "x" }, today)).rejects.toThrow();
  });
});
