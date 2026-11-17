import {
  DEFAULT_STEPS, nextStepId, routineDay, routineSteps, stepRowId, suggestLinks, tickRowId, validRoutineRow,
  type RoutineStepRow, type RoutineTickRow,
} from "./dailyRoutine";
import type { Item } from "./types";

// "Today's routine" on Home (Esme approved, 17 Nov 2026). All data is fictional.

const TODAY = "2026-11-17";
const habit = (id: string, title: string, extra: Partial<Item> = {}): Item => ({
  id, kind: "task", title, links: [], areaId: "mind", priority: 2, status: "open",
  createdAt: "2026-11-01", touchedAt: "2026-11-01", recur: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], ...extra,
});
const step = (stepId: string, fields: Omit<RoutineStepRow, "id"> = {}): RoutineStepRow => ({ id: stepRowId(stepId), ...fields });
const tick = (stepId: string, done: boolean, date = TODAY): RoutineTickRow => ({ id: tickRowId(date, stepId), date, step: stepId, done });

describe("the default routine", () => {
  it("is her ten steps, in order, each with its minimum", () => {
    const steps = routineSteps([]);
    expect(steps.map((s) => s.title)).toEqual([
      "Up between 8 and 9am",
      "5-minute meditation",
      "Daylight: outside or by the brightest window",
      "Vitamins with morning tea",
      "One workbook card",
      "Book: 30+ minutes, end with \"Next: …\"",
      "Today's lane (content, art or business)",
      "After lunch: 1–2 more workbook cards",
      "Wind down: screens down, evening check-in, glance at tomorrow's \"Next:\"",
      "Bed",
    ]);
    expect(steps[0]!.min).toBe("out of bed in that window, even after a bad night");
    expect(steps[7]!.min).toBe("skip, the morning one counts");
    expect(steps.every((s) => s.habitId === undefined)).toBe(true);
    expect(DEFAULT_STEPS).toHaveLength(10);
  });

  it("stored rows override a default step's fields, remove it, or add steps", () => {
    const steps = routineSteps([
      step("d2", { title: "Meditate (pretend)" }),
      step("d3", { removed: true }),
      step("abc12", { title: "Stretch", min: "one stretch", order: 2.5 }),
      step("d4", { habitId: "h-vit" }),
      step("d5", { habitId: null }),
    ]);
    expect(steps.map((s) => s.id).slice(0, 5)).toEqual(["d1", "d2", "abc12", "d4", "d5"]);
    expect(steps[1]!.title).toBe("Meditate (pretend)");
    expect(steps[1]!.min).toBe("three slow breaths on the edge of the bed"); // the default stays
    expect(steps[3]!.habitId).toBe("h-vit");
    expect(steps[4]!.habitId).toBeNull();
    expect(steps).toHaveLength(10);
  });

  it("orders ties by id, so two devices always show the same order", () => {
    const steps = routineSteps([step("d2", { order: 1 })]);
    expect(steps.map((s) => s.id).slice(0, 2)).toEqual(["d1", "d2"]);
  });
});

describe("rows are checked (sync and local writes)", () => {
  it("accepts well-formed step and tick rows", () => {
    expect(validRoutineRow(step("d1"))).toBe(true);
    expect(validRoutineRow(step("d1", { title: "x", min: "", order: 3, habitId: null, removed: false, updatedAt: 5 }))).toBe(true);
    expect(validRoutineRow(step("zz9", { title: "A new step" }))).toBe(true);
    expect(validRoutineRow(step("zz9", { removed: true }))).toBe(true);
    expect(validRoutineRow({ ...step("d1"), laterField: 1 })).toBe(true);
    expect(validRoutineRow(tick("d1", true))).toBe(true);
  });

  it("refuses malformed ones", () => {
    for (const bad of [
      step("d1", { title: "" }), step("d1", { title: "x".repeat(121) }), step("d1", { min: "x".repeat(201) }),
      step("d1", { order: Number.NaN }), step("d1", { habitId: 3 as never }), step("d1", { removed: "yes" as never }),
      step("zz9"), // a new step with no title
      { id: "routine-step:BAD ID", title: "x" },
      { id: "routine-step:", title: "x" },
      { ...tick("d1", true), done: "yes" },
      { ...tick("d1", true), date: "2026-11-18" }, // the id says another day
      { ...tick("d1", true), step: "d2" },
      { id: "routine-tick:2026-02-30:d1", date: "2026-02-30", step: "d1", done: true },
      { id: "routine-other:1" },
    ]) {
      expect(validRoutineRow(bad)).toBe(false);
    }
  });
});

describe("suggested habit links", () => {
  const habits = [
    habit("h-plan", "Plan my day"),
    habit("h-vit", "Vitamins"),
    habit("h-up", "Up by 8am + light"),
    habit("h-wind", "Wind down"),
    habit("h-yoga", "Yoga", { recur: ["tue", "sat"] }),
    habit("h-med", "Meditate", { status: "archived" }), // not live: never suggested
    { ...habit("h-task", "Vitamin shopping"), recur: undefined }, // a to-do, not a habit
  ];

  it("links obvious steps by keyword, each habit to one step at most", () => {
    expect(suggestLinks(routineSteps([]), habits)).toEqual([
      { stepId: "d1", habitId: "h-up" }, // "up by"; step 3's "light" then has no habit left
      { stepId: "d4", habitId: "h-vit" },
      { stepId: "d9", habitId: "h-wind" },
    ]);
  });

  it("never touches a step she linked or unlinked, nor a habit another step has", () => {
    const steps = routineSteps([step("d1", { habitId: null }), step("d6", { habitId: "h-vit" })]);
    expect(suggestLinks(steps, habits)).toEqual([
      { stepId: "d3", habitId: "h-up" }, // "light", now that step 1 is unlinked on purpose
      { stepId: "d9", habitId: "h-wind" },
    ]);
  });
});

describe("the day's view", () => {
  const habits = [habit("h-vit", "Vitamins", { doneDates: ["2026-11-16", TODAY] }), habit("h-up", "Up by 8am")];
  const steps = routineSteps([step("d4", { habitId: "h-vit" }), step("d1", { habitId: "h-up" })]);

  it("a linked step is ticked when its habit is done today; others by their own tick", () => {
    const day = routineDay(steps, habits, [tick("d2", true), tick("d3", false)], TODAY);
    expect(day.rows.filter((r) => r.done).map((r) => r.step.id)).toEqual(["d2", "d4"]);
    expect(day.rows.find((r) => r.step.id === "d4")!.habit?.title).toBe("Vitamins");
    expect(day.rows.find((r) => r.step.id === "d1")!.habit?.title).toBe("Up by 8am");
    expect(day.done).toBe(2);
    expect(day.total).toBe(10);
  });

  it("another day's ticks don't count (the list starts fresh each day)", () => {
    const day = routineDay(steps, [habit("h-vit", "Vitamins", { doneDates: ["2026-11-16"] })], [tick("d2", true, "2026-11-16")], TODAY);
    expect(day.done).toBe(0);
  });

  it("a link to a habit that's gone (binned, stopped) falls back to the step's own tick", () => {
    const gone = routineDay(steps, [habit("h-vit", "Vitamins", { status: "deleted", doneDates: [TODAY] })], [tick("d4", true)], TODAY);
    const row = gone.rows.find((r) => r.step.id === "d4")!;
    expect(row.habit).toBeUndefined();
    expect(row.done).toBe(true);
  });

  it("the next step is the first unticked one after the last ticked, so a skipped step never nags", () => {
    expect(nextStepId(routineDay(steps, [], [], TODAY).rows)).toBe("d1");
    expect(nextStepId(routineDay(steps, [], [tick("d1", true)], TODAY).rows)).toBe("d2");
    expect(nextStepId(routineDay(steps, [], [tick("d1", true), tick("d5", true)], TODAY).rows)).toBe("d6");
    // The last step ticked: back to the first one still open.
    expect(nextStepId(routineDay(steps, [], [tick("d10", true)], TODAY).rows)).toBe("d1");
    const all = DEFAULT_STEPS.map((s) => tick(s.id, true));
    expect(nextStepId(routineDay(routineSteps([]), [], all, TODAY).rows)).toBeNull();
  });
});
