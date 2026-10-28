import { describe, expect, it } from "vitest";
import { needsALook } from "./attention";
import { groupGoalTasks, monthlyProgress, overallProgress, tickedOff } from "./progress";
import { pickToday } from "./triage";
import type { Goal, Item } from "./types";

// Bin rows (deleted, purged) and unsorted Inbox items are never counted as to-dos.

const today = "2026-10-28"; // a Wednesday
const goal: Goal = {
  id: "g1", title: "Made-up goal", areaId: "art", kind: "practice", milestones: [], monthlyTarget: 4, createdAt: "2026-10-01",
};
const item = (id: string, extra: Partial<Item>): Item => ({
  id, kind: "task", title: id, links: [], areaId: "art", priority: 1, status: "open",
  createdAt: "2026-09-01", touchedAt: "2026-09-01", goalId: "g1", ...extra,
});

// Every one of these would count if it were open, sorted and live.
const binned: Item[] = [
  item("deleted-due", { status: "deleted", deletedAt: today, due: today, pinnedDate: today, recur: ["wed"] }),
  item("deleted-done", { status: "deleted", deletedAt: today, completedAt: today }),
  item("purged", { status: "purged", title: "", goalId: undefined, due: today }),
];
const unsorted: Item[] = [
  item("inbox-task", { areaId: "inbox", due: today, pinnedDate: today }),
  item("inbox-done", { areaId: "inbox", status: "done", completedAt: today }),
];

describe("Bin rows and unsorted Inbox items are not counted anywhere", () => {
  const all = [...binned, ...unsorted];

  it("Today", () => {
    const t = pickToday(all, [goal], today, {});
    expect([...t.rhythm, ...t.picks, ...t.alsoDue]).toEqual([]);
  });

  it("needs a look", () => {
    const l = needsALook(all, today);
    expect([...l.overdue, ...l.dueSoon, ...l.stale]).toEqual([]);
  });

  it("the month count and goal progress", () => {
    expect(tickedOff("art", all, today).thisMonth).toBe(0);
    expect(tickedOff("inbox", all, today).thisMonth).toBe(0);
    expect(monthlyProgress(goal, all, today)!.done).toBe(0);
    expect(overallProgress(goal, all, today)).toMatchObject({ thisYear: 0, streakDays: 0 });
  });

  it("a goal's task groups and next step", () => {
    expect(groupGoalTasks(goal, all, today).flatMap((g) => g.items)).toEqual([]);
  });
});
