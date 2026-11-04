import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { validItem } from "./validate";
import { createItem, deleteItem, getItem, listBin, putItemBack, repeatAgain, stopRepeating, tickItem, untickItem } from "./repo";
import { doneThisMonth } from "../domain/progress";
import { HABIT_WORDS, isHabit, isRepeating, stoppedRepeat } from "../domain/habits";
import { backlogItem, parseBacklog } from "../import/backlog";
import type { Goal } from "../domain/types";

// Stopping a repeat, repeating again, and keeping the history. Pretend data only.
const TODAY = "2026-11-04"; // a Wednesday
const base = { kind: "task" as const, priority: 2 as const };

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
  await db.pending.clear();
});

async function stretch(extra: Record<string, unknown> = {}) {
  return createItem(
    { ...base, title: "Pretend stretch", areaId: "body", recur: ["mon", "wed", "fri"], doneDates: ["2026-11-02", "2026-11-04"], ...extra },
    "2026-10-01",
  );
}

describe("stopRepeating", () => {
  it("clears the repeat, parks the days in the stash, and keeps every other field and the history", async () => {
    const h = await stretch({ goalId: "g1", notes: "pretend notes" });
    await stopRepeating(h.id, TODAY);
    const got = (await db.items.get(h.id))!;
    expect(got.recur).toBeUndefined();
    expect(got.stash).toEqual({ task: { recur: ["mon", "wed", "fri"] } });
    expect(got).toMatchObject({
      status: "open", areaId: "body", kind: "task", doneDates: ["2026-11-02", "2026-11-04"], goalId: "g1", notes: "pretend notes",
      touchedAt: TODAY,
    });
    expect(isHabit(got)).toBe(false);
    expect(validItem(got)).toBe(true);
  });

  it("leaves a done item done (with its completion date)", async () => {
    const h = await stretch();
    await db.items.update(h.id, { status: "done", completedAt: "2026-11-03" });
    await stopRepeating(h.id, TODAY);
    expect(await db.items.get(h.id)).toMatchObject({ status: "done", completedAt: "2026-11-03" });
  });

  it("does nothing to an item that does not repeat", async () => {
    const t = await createItem({ ...base, title: "Pretend one-off", areaId: "art" }, "2026-10-01");
    await stopRepeating(t.id, TODAY);
    expect(await db.items.get(t.id)).toEqual(t);
  });

  it("is undone whole by putItemBack of the row as it was", async () => {
    const h = await stretch();
    const before = (await getItem(h.id))!;
    await stopRepeating(h.id, TODAY);
    await putItemBack(before, TODAY);
    const got = (await db.items.get(h.id))!;
    expect(got.recur).toEqual(["mon", "wed", "fri"]);
    expect(got.stash).toBeUndefined();
  });

  it("keeps other stashed fields (a book's) beside the repeat", async () => {
    const h = await stretch({ stash: { book: { author: "Pretend Author" } } });
    await stopRepeating(h.id, TODAY);
    expect((await db.items.get(h.id))!.stash).toEqual({ book: { author: "Pretend Author" }, task: { recur: ["mon", "wed", "fri"] } });
  });
});

describe("repeatAgain", () => {
  it("puts the parked days back and empties the stash", async () => {
    const h = await stretch();
    await stopRepeating(h.id, TODAY);
    await repeatAgain(h.id, TODAY);
    const got = (await db.items.get(h.id))!;
    expect(got.recur).toEqual(["mon", "wed", "fri"]);
    expect(got.stash).toBeUndefined();
    expect(got.doneDates).toEqual(["2026-11-02", "2026-11-04"]);
    expect(isRepeating(got)).toBe(true);
  });

  it("keeps the rest of the stash and ignores an item with nothing parked", async () => {
    const h = await stretch({ stash: { book: { author: "Pretend Author" } } });
    await stopRepeating(h.id, TODAY);
    await repeatAgain(h.id, TODAY);
    expect((await db.items.get(h.id))!.stash).toEqual({ book: { author: "Pretend Author" } });
    const t = await createItem({ ...base, title: "Pretend one-off", areaId: "art" }, "2026-10-01");
    await repeatAgain(t.id, TODAY);
    expect(await db.items.get(t.id)).toEqual(t);
  });
});

describe("ticking never stops a repeat", () => {
  it("tick and untick keep the days and log only today", async () => {
    const h = await stretch({ doneDates: ["2026-11-02"] });
    await tickItem(h.id, TODAY);
    let got = (await db.items.get(h.id))!;
    expect(got).toMatchObject({ status: "open", recur: ["mon", "wed", "fri"], doneDates: ["2026-11-02", TODAY] });
    await untickItem(h.id, TODAY);
    got = (await db.items.get(h.id))!;
    expect(got).toMatchObject({ status: "open", recur: ["mon", "wed", "fri"], doneDates: ["2026-11-02"] });
  });
});

describe("history of a stopped item", () => {
  const goal: Goal = { id: "g1", title: "Pretend goal", areaId: "body", kind: "practice", milestones: [], createdAt: "2026-10-01" };

  it("its past ticks still count for its goal this month", async () => {
    const h = await stretch({ goalId: "g1" });
    expect(doneThisMonth(goal, [(await db.items.get(h.id))!], TODAY)).toBe(2);
    await stopRepeating(h.id, TODAY);
    expect(doneThisMonth(goal, [(await db.items.get(h.id))!], TODAY)).toBe(2);
  });

  it("a stopped item ticked afterwards counts its completion too, once", async () => {
    const h = await stretch({ goalId: "g1" });
    await stopRepeating(h.id, TODAY);
    await tickItem(h.id, TODAY); // now an ordinary to-do: done today (a day it was already ticked)
    expect(doneThisMonth(goal, [(await db.items.get(h.id))!], TODAY)).toBe(2);
  });
});

describe("stoppedRepeat and the words", () => {
  it("reads the parked days only from an item that no longer repeats", async () => {
    const h = await stretch();
    expect(stoppedRepeat((await db.items.get(h.id))!)).toBeUndefined();
    await stopRepeating(h.id, TODAY);
    expect(stoppedRepeat((await db.items.get(h.id))!)).toEqual(["mon", "wed", "fri"]);
  });
  it("says it in a line", () => {
    expect(HABIT_WORDS.repeatsLine(["fri", "mon", "wed"])).toBe("Repeats Mondays, Wednesdays and Fridays");
    expect(HABIT_WORDS.repeatsLine(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).toBe("Repeats every day");
    expect(HABIT_WORDS.repeatsLine(["sat"])).toBe("Repeats Saturdays");
  });
});

describe("delete moves a repeating item to the Bin, history and days intact", () => {
  it("undo gives the row back", async () => {
    const h = await stretch();
    const before = (await getItem(h.id))!;
    await deleteItem(h.id, TODAY);
    expect((await listBin()).map((i) => i.id)).toEqual([h.id]);
    await putItemBack(before, TODAY);
    expect(await db.items.get(h.id)).toMatchObject({ status: "open", recur: ["mon", "wed", "fri"], doneDates: ["2026-11-02", "2026-11-04"] });
  });
});

describe("items from the old imports", () => {
  it("a Backlog 'Weekly rhythm' line lands in the Inbox with its days: it counts as repeating and can be stopped", async () => {
    const md = "## 🔁 Weekly rhythm (recurring, scheduled by day)\n- [ ] Water the pretend herbs [recur: sat]\n";
    const [p] = parseBacklog(md).items;
    const item = backlogItem(p, "2026-10-01");
    expect(item.areaId).toBe("inbox");
    await db.items.add(item);
    expect(isRepeating((await db.items.get(item.id))!)).toBe(true);
    await stopRepeating(item.id, TODAY);
    const got = (await db.items.get(item.id))!;
    expect(got).toMatchObject({ areaId: "inbox", stash: { task: { recur: ["sat"] } } });
    expect(got.recur).toBeUndefined();
  });
});
