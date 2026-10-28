import { describe, expect, it } from "vitest";
import { doneToday, HABIT_WORDS, isHabit, MAX_DONE_DATES, sessions, withDoneDate, withoutDoneDate } from "./habits";
import { addDays } from "./dates";
import type { Item } from "./types";

const habit = (o: Partial<Item> = {}): Item => ({
  id: "h", kind: "task", title: "Pretend stretch", links: [], areaId: "body", priority: 2,
  status: "open", recur: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
  createdAt: "2026-01-01", touchedAt: "2026-01-01", ...o,
});

describe("habits", () => {
  it("a habit is a recurring to-do; an idea or a one-off is not", () => {
    expect(isHabit(habit())).toBe(true);
    expect(isHabit(habit({ recur: [] }))).toBe(false);
    expect(isHabit(habit({ recur: undefined }))).toBe(false);
    expect(isHabit(habit({ kind: "idea" }))).toBe(false);
  });

  it("done today is derived from the date: tomorrow it is unticked again", () => {
    const h = habit({ doneDates: ["2026-10-28"] });
    expect(doneToday(h, "2026-10-28")).toBe(true);
    expect(doneToday(h, "2026-10-29")).toBe(false);
  });

  it("the done log stays sorted with no repeats and keeps the most recent 400", () => {
    expect(withDoneDate(["2026-10-02", "2026-10-01"], "2026-10-02")).toEqual(["2026-10-01", "2026-10-02"]);
    const many = Array.from({ length: 450 }, (_, i) => addDays("2025-01-01", i));
    const log = withDoneDate(many, "2026-10-28");
    expect(log).toHaveLength(MAX_DONE_DATES);
    expect(log[log.length - 1]).toBe("2026-10-28");
    expect(log[0]).toBe(addDays("2025-01-01", 51)); // the oldest are dropped
    expect(withoutDoneDate(["2026-10-28"], "2026-10-28")).toBeUndefined();
    expect(withoutDoneDate(["2026-10-27", "2026-10-28"], "2026-10-28")).toEqual(["2026-10-27"]);
  });

  it("session numbers: planned days this month by weekday, done days this month only", () => {
    // October 2026: 31 days, Sundays on the 4th, 11th, 18th, 25th.
    const h = habit({
      recur: ["mon", "tue", "wed", "thu", "fri", "sat"],
      doneDates: ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-28"],
    });
    expect(sessions(h, "2026-10-28")).toEqual({ done: 3, planned: 27 });
    expect(sessions(habit({ recur: ["mon"] }), "2026-10-28").planned).toBe(4);
  });

  it("session numbers at month boundaries: the last day counts in its month, the 1st starts afresh", () => {
    const h = habit({ doneDates: ["2026-10-30", "2026-10-31"] });
    expect(sessions(h, "2026-10-31")).toEqual({ done: 2, planned: 31 });
    expect(sessions(h, "2026-11-01")).toEqual({ done: 0, planned: 30 });
    expect(sessions(habit({ doneDates: ["2026-12-31"] }), "2027-01-01")).toEqual({ done: 0, planned: 31 });
    // February in a leap year.
    expect(sessions(habit(), "2028-02-15").planned).toBe(29);
  });

  it("the schedule line", () => {
    expect(HABIT_WORDS.schedule(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).toBe("every day");
    expect(HABIT_WORDS.schedule(["mon", "tue", "wed", "thu", "fri", "sat"])).toBe("every day but Sunday");
    expect(HABIT_WORDS.schedule(["mon"])).toBe("Mondays");
    expect(HABIT_WORDS.schedule(["thu", "mon"])).toBe("Mondays and Thursdays");
    expect(HABIT_WORDS.schedule(["mon", "wed", "fri"])).toBe("Mondays, Wednesdays and Fridays");
  });

  it("the session wording", () => {
    expect(HABIT_WORDS.session("2026-10-28", 20, 28)).toBe("October · session 20 of 28");
  });
});
