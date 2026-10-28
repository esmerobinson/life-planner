import { db } from "./db";
import type { Item, Goal } from "../domain/types";

describe("db", () => {
  it("round-trips an item and a goal", async () => {
    const item: Item = {
      id: "i1", kind: "task", title: "Draft chapter", links: [], areaId: "writing",
      priority: 2, status: "open", createdAt: "2026-10-27", touchedAt: "2026-10-27",
    };
    const goal: Goal = {
      id: "g1", title: "Finish novel", areaId: "writing", kind: "finite",
      milestones: [{ id: "m1", title: "Outline", done: false }], createdAt: "2026-10-27",
    };
    await db.items.put(item);
    await db.goals.put(goal);
    expect(await db.items.get("i1")).toEqual(item);
    expect(await db.goals.get("g1")).toEqual(goal);
  });
});
