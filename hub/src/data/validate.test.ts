import { describe, expect, it } from "vitest";
import { validGoal, validItem } from "./validate";

const row = (o: Record<string, unknown> = {}) => ({
  id: "i1", kind: "task", title: "Pretend", links: [], areaId: "art", priority: 2,
  status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01", ...o,
});

describe("round 3 item fields", () => {
  it("rows without the new fields stay valid (older rows and older devices)", () => {
    expect(validItem(row())).toBe(true);
  });

  it("milestone is an optional boolean", () => {
    expect(validItem(row({ milestone: true }))).toBe(true);
    expect(validItem(row({ milestone: false }))).toBe(true);
    expect(validItem(row({ milestone: "yes" }))).toBe(false);
  });

  it("order is an optional finite number", () => {
    expect(validItem(row({ order: 0 }))).toBe(true);
    expect(validItem(row({ order: 3.5 }))).toBe(true);
    expect(validItem(row({ order: "1" }))).toBe(false);
    expect(validItem(row({ order: Number.NaN }))).toBe(false);
  });

  it("doneDates is an optional list of real dates, at most 400", () => {
    expect(validItem(row({ doneDates: ["2026-10-27", "2026-10-28"] }))).toBe(true);
    expect(validItem(row({ doneDates: [] }))).toBe(true);
    expect(validItem(row({ doneDates: ["2026-02-30"] }))).toBe(false);
    expect(validItem(row({ doneDates: "2026-10-28" }))).toBe(false);
    expect(validItem(row({ doneDates: Array.from({ length: 401 }, () => "2026-10-28") }))).toBe(false);
  });
});

describe("goal onHome (Show on Home)", () => {
  const goal = (o: Record<string, unknown> = {}) => ({
    id: "g1", title: "Pretend goal", areaId: "art", kind: "practice", milestones: [], createdAt: "2026-10-01", ...o,
  });

  it("is optional, so goals without it stay valid", () => {
    expect(validGoal(goal())).toBe(true);
  });

  it("is a boolean when present", () => {
    expect(validGoal(goal({ onHome: true }))).toBe(true);
    expect(validGoal(goal({ onHome: false }))).toBe(true);
    expect(validGoal(goal({ onHome: "yes" }))).toBe(false);
    expect(validGoal(goal({ onHome: 1 }))).toBe(false);
  });
});

describe("goals redesign fields (all optional)", () => {
  const goal = (o: Record<string, unknown> = {}) => ({
    id: "g1", title: "Pretend goal", areaId: "art", kind: "practice", milestones: [], createdAt: "2026-10-01", ...o,
  });
  const mg = (o: Record<string, unknown> = {}) => ({ id: "m1", month: "2026-11", kind: "count", title: "Sessions", target: 20, ...o });

  it("active is a boolean; rhythm is only daily", () => {
    expect(validGoal(goal({ active: false }))).toBe(true);
    expect(validGoal(goal({ active: "no" }))).toBe(false);
    expect(validGoal(goal({ rhythm: "daily" }))).toBe(true);
    expect(validGoal(goal({ rhythm: "weekly" }))).toBe(false);
  });

  it("countsFrom: the three kinds and areas (not the inbox), each once", () => {
    expect(validGoal(goal({ countsFrom: ["journal", "exercise", "linked", { area: "mind" }] }))).toBe(true);
    expect(validGoal(goal({ countsFrom: [] }))).toBe(true);
    expect(validGoal(goal({ countsFrom: ["journal", "journal"] }))).toBe(false);
    expect(validGoal(goal({ countsFrom: [{ area: "inbox" }] }))).toBe(false);
    expect(validGoal(goal({ countsFrom: [{ area: "nowhere" }] }))).toBe(false);
    expect(validGoal(goal({ countsFrom: [{ area: "mind", x: 1 }] }))).toBe(false);
    expect(validGoal(goal({ countsFrom: ["habits"] }))).toBe(false);
  });

  it("monthGoals: counts and steps with a real month, whole targets and real log dates", () => {
    expect(validGoal(goal({ monthGoals: [mg(), mg({ id: "s", kind: "step", target: undefined, done: true })] }))).toBe(true);
    expect(validGoal(goal({ monthGoals: [mg({ log: ["2026-11-02"], auto: false })] }))).toBe(true);
    expect(validGoal(goal({ monthGoals: [mg({ month: "2026-13" })] }))).toBe(false);
    expect(validGoal(goal({ monthGoals: [mg({ target: 2.5 })] }))).toBe(false);
    expect(validGoal(goal({ monthGoals: [mg({ target: 0 })] }))).toBe(false);
    expect(validGoal(goal({ monthGoals: [mg({ kind: "habit" })] }))).toBe(false);
    expect(validGoal(goal({ monthGoals: [mg({ log: ["2026-11-31"] })] }))).toBe(false);
    expect(validGoal(goal({ monthGoals: [mg(), mg()] }))).toBe(false); // the same id twice
  });

  it("caps: at most 200 monthly goals and 400 +1s on one (review M8)", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => mg({ id: `m${i}` }));
    expect(validGoal(goal({ monthGoals: many(200) }))).toBe(true);
    expect(validGoal(goal({ monthGoals: many(201) }))).toBe(false);
    expect(validGoal(goal({ monthGoals: [mg({ log: Array.from({ length: 400 }, () => "2026-11-02") })] }))).toBe(true);
    expect(validGoal(goal({ monthGoals: [mg({ log: Array.from({ length: 401 }, () => "2026-11-02") })] }))).toBe(false);
  });

  it("a purged goal carries no monthly goals", () => {
    expect(validGoal(goal({ title: "", status: "purged", monthGoals: [mg()] }))).toBe(false);
    expect(validGoal(goal({ title: "", status: "purged" }))).toBe(true);
  });
});

describe("project to-dos (sessions)", () => {
  const s = (o: Record<string, unknown> = {}) => ({ id: "s1", ...o });
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}` }));

  it("a to-do may carry 1 to 20 sessions", () => {
    expect(validItem(row({ sessions: many(1) }))).toBe(true);
    expect(validItem(row({ sessions: many(20) }))).toBe(true);
    expect(validItem(row({ sessions: [] }))).toBe(false);
    expect(validItem(row({ sessions: many(21) }))).toBe(false);
    expect(validItem(row({ sessions: "4" }))).toBe(false);
  });

  it("a session has an id and optional title (<= 120), details (<= 1000), doneOn and plannedFor dates", () => {
    expect(
      validItem(row({ sessions: [s({ title: "Block out the street", details: "Rough shapes only", doneOn: "2026-10-30", plannedFor: "2026-11-05" })] })),
    ).toBe(true);
    expect(validItem(row({ sessions: [s({ title: "x".repeat(120) })] }))).toBe(true);
    expect(validItem(row({ sessions: [s({ title: "x".repeat(121) })] }))).toBe(false);
    expect(validItem(row({ sessions: [s({ title: "" })] }))).toBe(false);
    expect(validItem(row({ sessions: [s({ details: "x".repeat(1000) })] }))).toBe(true);
    expect(validItem(row({ sessions: [s({ details: "x".repeat(1001) })] }))).toBe(false);
    expect(validItem(row({ sessions: [s({ details: "" })] }))).toBe(false);
    expect(validItem(row({ sessions: [s({ doneOn: "2026-02-30" })] }))).toBe(false);
    expect(validItem(row({ sessions: [s({ plannedFor: "soon" })] }))).toBe(false);
    expect(validItem(row({ sessions: [{ title: "No id" }] }))).toBe(false);
    expect(validItem(row({ sessions: [s({ id: "" })] }))).toBe(false);
    expect(validItem(row({ sessions: [s({ id: "x".repeat(65) })] }))).toBe(false);
  });

  it("a session holds nothing else, and ids are distinct", () => {
    expect(validItem(row({ sessions: [s({ colour: "red" })] }))).toBe(false);
    expect(validItem(row({ sessions: [s(), s()] }))).toBe(false);
  });

  it("only a to-do can be a project, and a project does not repeat", () => {
    expect(validItem(row({ kind: "idea", sessions: many(2) }))).toBe(false);
    expect(validItem(row({ recur: ["mon"], sessions: many(2) }))).toBe(false);
  });

  it("an emptied-from-the-Bin tombstone carries no sessions", () => {
    const tomb = row({ status: "purged", title: "" });
    expect(validItem(tomb)).toBe(true);
    expect(validItem({ ...tomb, sessions: many(1) })).toBe(false);
  });
});
