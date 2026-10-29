import { describe, expect, it } from "vitest";
import { dayLabel, dueLine, monthName, nextFriday, nextMonday, shortDate } from "./display";
import type { Item } from "./types";

const TODAY = "2026-10-28"; // a Wednesday

const item = (o: Partial<Item> = {}): Item => ({
  id: "i", kind: "task", title: "t", links: [], areaId: "writing", priority: 2,
  status: "open", createdAt: "2026-01-01", touchedAt: "2026-01-01", ...o,
});

describe("dayLabel / shortDate / monthName", () => {
  it("formats a weekday, day and month in plain English", () => {
    expect(dayLabel("2026-10-26", TODAY)).toBe("Mon 26 Oct");
    expect(dayLabel("2026-10-29", TODAY)).toBe("Thu 29 Oct");
    expect(shortDate("2026-12-31", TODAY)).toBe("31 Dec");
    expect(shortDate("2026-10-27", TODAY)).toBe("27 Oct");
  });
  it("adds the year only when it is not this year", () => {
    expect(dayLabel("2027-01-04", TODAY)).toBe("Mon 4 Jan 2027");
    expect(shortDate("2027-03-31", TODAY)).toBe("31 Mar 2027");
  });
  it("names the month", () => {
    expect(monthName("2026-10-28")).toBe("October");
    expect(monthName("2026-01-01")).toBe("January");
  });
  it("next Monday is the Monday after this week", () => {
    expect(nextMonday("2026-10-28")).toBe("2026-11-02");
    expect(nextMonday("2026-11-01")).toBe("2026-11-02"); // a Sunday
    expect(nextMonday("2026-11-02")).toBe("2026-11-09"); // a Monday: the following one
  });
  it("Friday is the next Friday after today; on a Friday, the one a week later", () => {
    expect(nextFriday("2026-10-28")).toBe("2026-10-30"); // a Wednesday
    expect(nextFriday("2026-10-30")).toBe("2026-11-06"); // a Friday
    expect(nextFriday("2026-10-31")).toBe("2026-11-06"); // a Saturday
    expect(nextFriday("2026-11-02")).toBe("2026-11-06"); // a Monday
  });
});

describe("dueLine", () => {
  it("is empty without a due date or a pin", () => {
    expect(dueLine(item(), TODAY)).toEqual({});
  });
  it("says Due <day> for a later date", () => {
    expect(dueLine(item({ due: "2026-10-30" }), TODAY)).toEqual({ due: "Due Fri 30 Oct", late: false });
  });
  it("says Due today and Due tomorrow", () => {
    expect(dueLine(item({ due: TODAY }), TODAY).due).toBe("Due today");
    expect(dueLine(item({ due: "2026-10-29" }), TODAY).due).toBe("Due tomorrow");
  });
  it("adds how late it is when overdue", () => {
    expect(dueLine(item({ due: "2026-10-26" }), TODAY)).toEqual({ due: "Due Mon 26 Oct · 2 days late", late: true });
    expect(dueLine(item({ due: "2026-10-27" }), TODAY)).toEqual({ due: "Due Tue 27 Oct · 1 day late", late: true });
  });
  it("shows the day it is pinned to, today or later", () => {
    expect(dueLine(item({ pinnedDate: "2026-10-29" }), TODAY)).toEqual({ on: "On Thu 29 Oct" });
    expect(dueLine(item({ pinnedDate: TODAY }), TODAY)).toEqual({ on: "On Wed 28 Oct" });
    expect(dueLine(item({ pinnedDate: "2026-10-20" }), TODAY)).toEqual({}); // an old pin no longer means anything
    expect(dueLine(item({ due: "2026-10-26", pinnedDate: "2026-10-29" }), TODAY)).toEqual({
      due: "Due Mon 26 Oct · 2 days late",
      late: true,
      on: "On Thu 29 Oct",
    });
  });
});
