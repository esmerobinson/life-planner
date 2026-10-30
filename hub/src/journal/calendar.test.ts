import { daysInARow, doneInMonth, monthGrid, shiftMonth, streakLine } from "./calendar";

const set = (...d: string[]) => new Set(d);

describe("month grid", () => {
  it("October 2026 starts on a Thursday: three blanks, then 31 days", () => {
    const cells = monthGrid("2026-10");
    expect(cells.slice(0, 3).every((c) => c.blank)).toBe(true);
    expect(cells[3]).toEqual({ blank: false, date: "2026-10-01", day: 1 });
    expect(cells.filter((c) => !c.blank)).toHaveLength(31);
    expect(cells.at(-1)).toEqual({ blank: false, date: "2026-10-31", day: 31 });
  });

  it("a month starting on Monday has no blanks; February in a leap year has 29 days", () => {
    expect(monthGrid("2026-06")[0]).toEqual({ blank: false, date: "2026-06-01", day: 1 });
    expect(monthGrid("2028-02").filter((c) => !c.blank)).toHaveLength(29);
    expect(monthGrid("2027-02").filter((c) => !c.blank)).toHaveLength(28);
  });

  it("moves between months across a year", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
    expect(shiftMonth("2026-10", -13)).toBe("2025-09");
  });
});

describe("streak", () => {
  it("counts back from today when today is done", () => {
    expect(daysInARow(set("2026-10-26", "2026-10-27", "2026-10-28"), "2026-10-28")).toBe(3);
  });

  it("counts back from yesterday when today isn't done yet", () => {
    expect(daysInARow(set("2026-10-26", "2026-10-27"), "2026-10-28")).toBe(2);
  });

  it("is 0 when neither today nor yesterday is done", () => {
    expect(daysInARow(set("2026-10-25", "2026-10-26"), "2026-10-28")).toBe(0);
  });

  it("runs across a month boundary and a year boundary", () => {
    expect(daysInARow(set("2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"), "2026-10-02")).toBe(4);
    expect(daysInARow(set("2026-12-31", "2027-01-01"), "2027-01-02")).toBe(2);
    expect(daysInARow(set("2028-02-28", "2028-02-29", "2028-03-01"), "2028-03-01")).toBe(3);
  });

  it("this month counts only the current month's days", () => {
    const done = set("2026-09-30", "2026-10-01", "2026-10-15", "2026-11-01");
    expect(doneInMonth(done, "2026-10")).toBe(2);
  });

  it("the line: both parts, the month alone, or nothing (never a broken-streak message)", () => {
    expect(streakLine(set("2026-10-27", "2026-10-28", "2026-10-02"), "2026-10-28")).toBe("2 days in a row · 3 this month");
    expect(streakLine(set("2026-10-28"), "2026-10-28")).toBe("1 day in a row · 1 this month");
    expect(streakLine(set("2026-10-02"), "2026-10-28")).toBe("1 this month");
    expect(streakLine(set("2026-09-30"), "2026-10-01")).toBe("1 day in a row");
    expect(streakLine(set(), "2026-10-28")).toBeNull();
  });
});
