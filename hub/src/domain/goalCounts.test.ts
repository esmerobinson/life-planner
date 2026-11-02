import { describe, expect, it } from "vitest";
import {
  canPlanMonth, countedDays, dailyStatus, daysInMonth, goalEvents, isActive, monthCount, monthDots, monthHit,
  monthsInARowHit, monthSummary, pastMonths, plannedFromLastMonth, type GoalSources,
} from "./goalCounts";
import type { Goal, Item, MonthGoal } from "./types";

const goal = (o: Partial<Goal> = {}): Goal => ({
  id: "g1", title: "Pretend goal", areaId: "mind", kind: "practice", milestones: [], createdAt: "2026-01-01", ...o,
});
const task = (o: Partial<Item>): Item => ({
  id: "t1", kind: "task", title: "Pretend", links: [], areaId: "mind", priority: 2, status: "open",
  createdAt: "2026-01-01", touchedAt: "2026-01-01", ...o,
});
const count = (month: string, o: Partial<MonthGoal> = {}): MonthGoal => ({
  id: `c-${month}`, month, kind: "count", title: "Sessions", target: 3, ...o,
});
const src = (o: Partial<GoalSources> = {}): GoalSources => ({ journalDays: new Set(), exercise: [], items: [], ...o });

describe("goalEvents: the sources", () => {
  it("journal: one event per day with a page, photo or answer", () => {
    const g = goal({ countsFrom: ["journal"] });
    const ev = goalEvents(g, src({ journalDays: new Set(["2026-11-01", "2026-11-02"]) }));
    expect(ev.map((e) => e.date).sort()).toEqual(["2026-11-01", "2026-11-02"]);
  });

  it("exercise: each card done counts once (two devices marking the same card is one)", () => {
    const g = goal({ countsFrom: ["exercise"] });
    const ev = goalEvents(g, src({
      exercise: [
        { date: "2026-11-01", card: "a" }, { date: "2026-11-01", card: "a" }, { date: "2026-11-01", card: "b" },
      ],
    }));
    expect(ev).toHaveLength(2);
  });

  it("exercise while locked (null) counts nothing", () => {
    expect(goalEvents(goal({ countsFrom: ["exercise"] }), src({ exercise: null }))).toEqual([]);
  });

  it("linked: done to-dos linked to the goal and linked habit sessions; others and the inbox don't", () => {
    const g = goal({ countsFrom: ["linked"] });
    const items = [
      task({ id: "a", goalId: "g1", status: "done", completedAt: "2026-11-02" }),
      task({ id: "b", goalId: "g1", recur: ["mon"], doneDates: ["2026-11-02", "2026-10-30"] }),
      task({ id: "c", goalId: "other", status: "done", completedAt: "2026-11-02" }),
      task({ id: "d", goalId: "g1", status: "open" }),
      task({ id: "e", goalId: "g1", areaId: "inbox", status: "done", completedAt: "2026-11-02" }),
    ];
    expect(goalEvents(g, src({ items })).map((e) => e.key).sort()).toEqual([
      "item:a:2026-11-02", "item:b:2026-10-30", "item:b:2026-11-02",
    ]);
  });

  it("an area: every done to-do and habit session there; a linked one in that area counts once", () => {
    const g = goal({ countsFrom: ["linked", { area: "mind" }] });
    const items = [
      task({ id: "a", goalId: "g1", status: "done", completedAt: "2026-11-02" }),
      task({ id: "b", status: "done", completedAt: "2026-11-01" }),
      task({ id: "c", areaId: "art", status: "done", completedAt: "2026-11-01" }),
    ];
    expect(goalEvents(g, src({ items }))).toHaveLength(2);
  });
});

describe("monthCount", () => {
  it("automatic count: the month's events; a daily goal counts days", () => {
    const sources = src({
      exercise: [{ date: "2026-11-01", card: "a" }, { date: "2026-11-01", card: "b" }, { date: "2026-10-31", card: "c" }],
    });
    const m = count("2026-11");
    expect(monthCount(goal({ countsFrom: ["exercise"] }), m, sources)).toBe(2);
    expect(monthCount(goal({ countsFrom: ["exercise"], rhythm: "daily" }), m, sources)).toBe(1);
  });

  it("month boundary: the 31st counts for October, the 1st for November", () => {
    const g = goal({ countsFrom: ["journal"], rhythm: "daily" });
    const s = src({ journalDays: new Set(["2026-10-31", "2026-11-01"]) });
    expect(monthCount(g, count("2026-10"), s)).toBe(1);
    expect(monthCount(g, count("2026-11"), s)).toBe(1);
    expect(monthCount(g, count("2026-12"), s)).toBe(0);
  });

  it("manual count: its +1s; auto false stays manual even with sources", () => {
    const m = count("2026-11", { log: ["2026-11-01", "2026-11-01", "2026-11-02"] });
    expect(monthCount(goal(), m, src())).toBe(3);
    expect(monthCount(goal({ rhythm: "daily" }), m, src())).toBe(2);
    expect(monthCount(goal({ countsFrom: ["journal"] }), { ...m, auto: false }, src())).toBe(3);
  });

  it("a step has no count", () => {
    expect(monthCount(goal(), { id: "s", month: "2026-11", kind: "step", title: "x" }, src())).toBe(0);
  });
});

describe("monthHit, dots and months in a row", () => {
  const months = (hits: Record<string, number | null>, target = 3): Goal =>
    goal({
      monthGoals: Object.entries(hits)
        .filter(([, n]) => n !== null)
        .map(([m, n]) => count(m, { target, log: Array.from({ length: n! }, () => `${m}-01`) })),
    });

  it("hit when the first count reaches its target; null with no monthly goals", () => {
    const g = months({ "2026-10": 3, "2026-09": 2 });
    expect(monthHit(g, "2026-10", src())).toBe(true);
    expect(monthHit(g, "2026-09", src())).toBe(false);
    expect(monthHit(g, "2026-08", src())).toBeNull();
  });

  it("only steps: hit when every step is ticked", () => {
    const step = (done: boolean, id: string): MonthGoal => ({ id, month: "2026-10", kind: "step", title: id, done });
    expect(monthHit(goal({ monthGoals: [step(true, "a"), step(true, "b")] }), "2026-10", src())).toBe(true);
    expect(monthHit(goal({ monthGoals: [step(true, "a"), step(false, "b")] }), "2026-10", src())).toBe(false);
  });

  it("the first count decides even when a later count or step isn't done", () => {
    const g = goal({
      monthGoals: [
        count("2026-10", { id: "a", log: ["2026-10-01", "2026-10-02", "2026-10-03"] }),
        count("2026-10", { id: "b", log: [] }),
        { id: "s", month: "2026-10", kind: "step", title: "x", done: false },
      ],
    });
    expect(monthHit(g, "2026-10", src())).toBe(true);
  });

  it("six dots, oldest first, this month last and marked now (across a year boundary)", () => {
    const g = months({ "2026-12": 3, "2026-11": 1 });
    const dots = monthDots(g, "2027-02-10", src());
    expect(dots.map((d) => d.month)).toEqual(["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(dots.map((d) => d.hit)).toEqual([null, null, false, true, null, null]);
    expect(dots.map((d) => d.now)).toEqual([false, false, false, false, false, true]);
  });

  it("months in a row end last month; this month joins once it is hit", () => {
    const g = months({ "2026-08": 3, "2026-09": 3, "2026-10": 3, "2026-11": 1 });
    expect(monthsInARowHit(g, "2026-11-02", src())).toBe(3);
    const hitNow = months({ "2026-09": 3, "2026-10": 3, "2026-11": 3 });
    expect(monthsInARowHit(hitNow, "2026-11-02", src())).toBe(3);
    const broken = months({ "2026-08": 3, "2026-09": 0, "2026-10": 3 });
    expect(monthsInARowHit(broken, "2026-11-02", src())).toBe(1);
    expect(monthsInARowHit(months({}), "2026-11-02", src())).toBe(0);
  });

  it("months in a row across January: December and November count", () => {
    const g = months({ "2026-11": 3, "2026-12": 3 });
    expect(monthsInARowHit(g, "2027-01-01", src())).toBe(2);
  });

  it("monthSummary: the first count, else steps done of all; null with none", () => {
    expect(monthSummary(months({ "2026-11": 2 }, 5), "2026-11", src())).toEqual({ n: 2, of: 5 });
    const steps = goal({ monthGoals: [{ id: "a", month: "2026-11", kind: "step", title: "a", done: true }, { id: "b", month: "2026-11", kind: "step", title: "b" }] });
    expect(monthSummary(steps, "2026-11", src())).toEqual({ n: 1, of: 2 });
    expect(monthSummary(goal(), "2026-11", src())).toBeNull();
  });

  it("past months: newest first, this month left out", () => {
    const g = months({ "2026-09": 3, "2026-10": 1, "2026-11": 3 });
    expect(pastMonths(g, "2026-11-02", src())).toEqual([
      { month: "2026-10", hit: false, summary: { n: 1, of: 3 } },
      { month: "2026-09", hit: true, summary: { n: 3, of: 3 } },
    ]);
  });
});

describe("daily goals", () => {
  it("the streak ends today, or yesterday while today isn't done (the journal rows' function)", () => {
    const g = goal({ rhythm: "daily", countsFrom: ["journal"] });
    const s = src({ journalDays: new Set(["2026-10-31", "2026-11-01"]) });
    const st = dailyStatus(g, "2026-11-02", s);
    expect(st.done).toBe(false);
    expect(st.streak).toBe(2);
    expect(st.week).toEqual([false, false, false, false, true, true, false]);
  });

  it("a daily goal without sources counts the days logged on its counts", () => {
    const g = goal({ rhythm: "daily", monthGoals: [count("2026-11", { log: ["2026-11-01", "2026-11-02"] })] });
    expect([...countedDays(g, src())].sort()).toEqual(["2026-11-01", "2026-11-02"]);
    expect(dailyStatus(g, "2026-11-02", src()).done).toBe(true);
  });
});

describe("planning a new month", () => {
  let n = 0;
  const id = () => `new-${++n}`;

  it("copies last month's counts with their targets; steps aren't copied", () => {
    const g = goal({
      monthGoals: [
        count("2026-10", { id: "a", title: "Writing sessions", target: 20, log: ["2026-10-02"] }),
        { id: "s", month: "2026-10", kind: "step", title: "Send chapter 3" },
      ],
    });
    expect(canPlanMonth(g, "2026-11-01")).toBe(true);
    const plan = plannedFromLastMonth(g, "2026-11-01", id);
    expect(plan).toEqual([{ id: expect.any(String), month: "2026-11", kind: "count", title: "Writing sessions", target: 20 }]);
  });

  it("not offered once this month has goals, nor when last month had only steps or nothing", () => {
    expect(canPlanMonth(goal({ monthGoals: [count("2026-10"), count("2026-11", { id: "x" })] }), "2026-11-02")).toBe(false);
    expect(canPlanMonth(goal({ monthGoals: [{ id: "s", month: "2026-10", kind: "step", title: "x" }] }), "2026-11-02")).toBe(false);
    expect(canPlanMonth(goal(), "2026-11-02")).toBe(false);
    expect(plannedFromLastMonth(goal(), "2026-11-02", id)).toEqual([]);
  });

  it("a daily goal's every-day target follows the month's length (31 in October, 30 in November)", () => {
    const g = goal({ rhythm: "daily", monthGoals: [count("2026-10", { target: 31 })] });
    expect(plannedFromLastMonth(g, "2026-11-01", id)[0]!.target).toBe(30);
    const jan = goal({ rhythm: "daily", monthGoals: [count("2026-12", { target: 31 })] });
    expect(plannedFromLastMonth(jan, "2027-01-01", id)[0]!.month).toBe("2027-01");
  });

  it("daysInMonth", () => {
    expect(daysInMonth("2026-11")).toBe(30);
    expect(daysInMonth("2028-02")).toBe(29);
  });
});

describe("older goals with only a monthlyTarget (fix round 1, I2)", () => {
  const done = (id: string, d: string, extra: Partial<Item> = {}) =>
    task({ id, goalId: "g1", areaId: "writing", status: "done", completedAt: d, ...extra });
  const items = [
    done("a", "2026-09-03"), done("b", "2026-09-10"), // September: 2 of 2
    done("c", "2026-10-05"), // October: 1 of 2
    done("d", "2026-11-01"), done("e", "2026-11-02"), // November: 2 of 2
    task({ id: "h", goalId: "g1", areaId: "writing", recur: ["mon"], doneDates: ["2026-08-03"] }), // a habit session in August
    done("x", "2026-11-02", { goalId: "other" }),
  ];
  const old = goal({ areaId: "writing", monthlyTarget: 2 });

  it("a month without monthly goals counts the linked to-dos ticked (and linked habit sessions), as the old bar did", () => {
    expect(monthSummary(old, "2026-11", src({ items }))).toEqual({ n: 2, of: 2 });
    expect(monthSummary(old, "2026-10", src({ items }))).toEqual({ n: 1, of: 2 });
    expect(monthSummary(old, "2026-08", src({ items }))).toEqual({ n: 1, of: 2 });
    expect(monthHit(old, "2026-09", src({ items }))).toBe(true);
    expect(monthHit(old, "2026-10", src({ items }))).toBe(false);
  });

  it("dots, months in a row and Past months come from that history", () => {
    expect(monthDots(old, "2026-11-02", src({ items })).map((d) => d.hit)).toEqual([false, false, false, true, false, true]);
    expect(monthsInARowHit(old, "2026-11-02", src({ items }))).toBe(1);
    expect(pastMonths(old, "2026-11-02", src({ items })).map((p) => [p.month, p.hit, p.summary])).toEqual([
      ["2026-10", false, { n: 1, of: 2 }],
      ["2026-09", true, { n: 2, of: 2 }],
      ["2026-08", false, { n: 1, of: 2 }],
    ]);
  });

  it("a month with monthly goals uses them; no monthlyTarget means no fallback", () => {
    const both = { ...old, monthGoals: [count("2026-11", { target: 5, log: ["2026-11-01"] })] };
    expect(monthSummary(both, "2026-11", src({ items }))).toEqual({ n: 1, of: 5 });
    expect(monthSummary(goal({ areaId: "writing" }), "2026-11", src({ items }))).toBeNull();
    expect(monthHit(goal({ areaId: "writing" }), "2026-11", src({ items }))).toBeNull();
  });
});

it("isActive: missing means active", () => {
  expect(isActive(goal())).toBe(true);
  expect(isActive(goal({ active: false }))).toBe(false);
});
