import { describe, expect, it } from "vitest";
import { monthlyProgress, overallProgress } from "./progress";
import type { Goal, Item } from "./types";

const goal = (o: Partial<Goal> = {}): Goal => ({
  id: "g1", title: "G", areaId: "writing", kind: "practice",
  milestones: [], createdAt: "2026-01-01", ...o,
});
let n = 0;
const done = (completedAt: string, o: Partial<Item> = {}): Item => ({
  id: `i${n++}`, kind: "task", title: "t", links: [],
  areaId: "writing", goalId: "g1", priority: 2, status: "done", completedAt,
  createdAt: "2026-01-01", touchedAt: "2026-01-01", ...o,
});

describe("monthlyProgress", () => {
  it("monthly done counts only this month", () => {
    const items = [done("2026-10-02"), done("2026-10-20"), done("2026-09-30"), done("2026-10-05", { goalId: "other" })];
    expect(monthlyProgress(goal({ monthlyTarget: 4 }), items, "2026-10-27")).toEqual({ done: 2, target: 4, ratio: 0.5 });
  });
  it("task completed 2026-10-31 counts in October, not November", () => {
    const items = [done("2026-10-31")];
    const g = goal({ monthlyTarget: 2 });
    expect(monthlyProgress(g, items, "2026-10-31")!.done).toBe(1);
    expect(monthlyProgress(g, items, "2026-11-01")!.done).toBe(0);
  });
  it("no target returns null", () => {
    expect(monthlyProgress(goal(), [], "2026-10-27")).toBeNull();
  });
  it("target 0 returns null (no NaN)", () => {
    expect(monthlyProgress(goal({ monthlyTarget: 0 }), [done("2026-10-01")], "2026-10-27")).toBeNull();
  });
  it("ratio caps at 1", () => {
    const items = [done("2026-10-01"), done("2026-10-02"), done("2026-10-03")];
    expect(monthlyProgress(goal({ monthlyTarget: 2 }), items, "2026-10-27")).toEqual({ done: 3, target: 2, ratio: 1 });
  });
  it("archived items do not count", () => {
    const items = [done("2026-10-01", { status: "archived" }), done("2026-10-02", { status: "open" })];
    expect(monthlyProgress(goal({ monthlyTarget: 2 }), items, "2026-10-27")!.done).toBe(0);
  });
});

describe("overallProgress", () => {
  it("finite goal with zero milestones has ratio 0", () => {
    expect(overallProgress(goal({ kind: "finite" }), [], "2026-10-27")).toEqual({ kind: "milestones", done: 0, total: 0, ratio: 0 });
  });
  it("finite goal counts done milestones", () => {
    const g = goal({ kind: "finite", milestones: [{ id: "a", title: "a", done: true }, { id: "b", title: "b", done: false }] });
    expect(overallProgress(g, [], "2026-10-27")).toEqual({ kind: "milestones", done: 1, total: 2, ratio: 0.5 });
  });
  it("completion on 2026-12-31 counts in 2026 year total, not 2027", () => {
    const items = [done("2026-12-31")];
    expect(overallProgress(goal(), items, "2026-12-31")).toMatchObject({ kind: "evidence", thisYear: 1 });
    expect(overallProgress(goal(), items, "2027-01-01")).toMatchObject({ kind: "evidence", thisYear: 0 });
  });
  it("practice goal reports thisYear, monthsInARow across a year boundary, streakDays", () => {
    const items = [
      done("2026-11-10"), done("2026-12-31"), done("2027-01-01"), done("2027-01-02"), done("2027-02-03"),
      done("2026-09-01"), // gap in October breaks the chain
      done("2027-02-03", { status: "archived" }),
    ];
    expect(overallProgress(goal(), items, "2027-02-03")).toEqual({ kind: "evidence", thisYear: 3, monthsInARow: 4, streakDays: 1 });
  });
  it("streak ends yesterday, and is 0 if neither today nor yesterday", () => {
    const items = [done("2026-10-24"), done("2026-10-25"), done("2026-10-26")];
    expect(overallProgress(goal(), items, "2026-10-27")).toMatchObject({ streakDays: 3 });
    expect(overallProgress(goal(), items, "2026-10-28")).toMatchObject({ streakDays: 0 });
  });
  it("monthsInARow is 0 when this month has none", () => {
    expect(overallProgress(goal(), [done("2026-09-10")], "2026-10-27")).toMatchObject({ monthsInARow: 0 });
  });
});
