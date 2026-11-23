import {
  defaultReviewWeek, EMPTY_WEEKLY_REVIEW, isWeeklyReviewEntry, MAX_REFLECTIONS, otherReviewWeek, reviewTitle, weeklyReviewFields,
  weeklyReviewFilled, weeklyReviewKey,
} from "./weeklyReview";
import { MAX_REVIEW_TEXT } from "./routine";

// Weekly review v2 (Esme, 17 and 23 Nov 2026): the title, which week opens, and what a sealed
// version may hold. Made-up words only.

describe("the title: always 'Weekly Review [MM-DD-YYYY-MM-DD-YYYY]', Monday to Sunday", () => {
  it("names the week's Monday and Sunday", () => {
    expect(reviewTitle("2026-11-16")).toBe("Weekly Review [11-16-2026-11-22-2026]");
  });
  it("any day of the week gives the same title", () => {
    expect(reviewTitle("2026-11-19")).toBe("Weekly Review [11-16-2026-11-22-2026]");
    expect(reviewTitle("2026-11-22")).toBe("Weekly Review [11-16-2026-11-22-2026]");
  });
  it("across a month and a year end", () => {
    expect(reviewTitle("2026-12-28")).toBe("Weekly Review [12-28-2026-01-03-2027]");
    expect(reviewTitle("2026-11-30")).toBe("Weekly Review [11-30-2026-12-06-2026]");
  });
});

describe("which week opens", () => {
  // 2026-11-23 is a Monday.
  it("Friday to Sunday: this week, whatever last week holds", () => {
    for (const day of ["2026-11-27", "2026-11-28", "2026-11-29"]) {
      expect(defaultReviewWeek(day, false)).toBe("2026-11-23");
      expect(defaultReviewWeek(day, true)).toBe("2026-11-23");
    }
  });
  it("Monday to Thursday: last week, while last week's review isn't done", () => {
    for (const day of ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"]) expect(defaultReviewWeek(day, false)).toBe("2026-11-16");
  });
  it("Monday to Thursday with last week's done: this week", () => {
    for (const day of ["2026-11-23", "2026-11-26"]) expect(defaultReviewWeek(day, true)).toBe("2026-11-23");
  });
  it("the other week: this week's other is last week, and back", () => {
    expect(otherReviewWeek("2026-11-25", "2026-11-23")).toBe("2026-11-16");
    expect(otherReviewWeek("2026-11-25", "2026-11-16")).toBe("2026-11-23");
  });
});

const FULL = {
  ...EMPTY_WEEKLY_REVIEW,
  selfHarm: "yes" as const, selfHarmWhat: "Pretend Ombrel happened",
  urges: "no" as const, urgesNote: "",
  fight: "yes" as const, fightAbout: "Pretend Ombrel dishes", fightTrigger: "Pretend tiredness", fightResolved: "Pretend talked it out",
  productive: "partly" as const, achieved: "Pretend drafts", struggled: "Pretend emails",
  well: "Pretend walk", inWay: "Pretend rain", values: 6, ifThen: "If pretend, then pretend", minDays: ["thu" as const, "mon" as const],
  dbt: "Pretend TIPP", sleep: "ok" as const, sleepNote: "Pretend late nights", proud: "Pretend finished a sketch", more: "Pretend more words",
};
const stamp = { v: 1, submittedAt: null, at: 5 };

describe("a sealed version", () => {
  it("accepts every answer, and an empty one", () => {
    expect(isWeeklyReviewEntry({ ...stamp, ...FULL })).toBe(true);
    expect(isWeeklyReviewEntry({ ...stamp, ...EMPTY_WEEKLY_REVIEW })).toBe(true);
  });
  it("refuses a wrong choice, a missing box, a value out of range, a box too long", () => {
    expect(isWeeklyReviewEntry({ ...stamp, ...FULL, selfHarm: "partly" })).toBe(false);
    expect(isWeeklyReviewEntry({ ...stamp, ...FULL, sleep: "great" })).toBe(false);
    expect(isWeeklyReviewEntry({ ...stamp, ...FULL, productive: "maybe" })).toBe(false);
    const { proud: _gone, ...noProud } = FULL;
    expect(isWeeklyReviewEntry({ ...stamp, ...noProud })).toBe(false);
    expect(isWeeklyReviewEntry({ ...stamp, ...FULL, values: 11 })).toBe(false);
    expect(isWeeklyReviewEntry({ ...stamp, ...FULL, fightAbout: "x".repeat(MAX_REVIEW_TEXT + 1) })).toBe(false);
    expect(isWeeklyReviewEntry({ ...stamp, ...FULL, more: "x".repeat(MAX_REFLECTIONS) })).toBe(true);
    expect(isWeeklyReviewEntry({ ...stamp, ...FULL, more: "x".repeat(MAX_REFLECTIONS + 1) })).toBe(false);
    expect(isWeeklyReviewEntry({ ...stamp, ...FULL, minDays: ["mon", "mon"] })).toBe(false);
  });
  it("filled: any one answer; the key ignores outer spaces and day order", () => {
    expect(weeklyReviewFilled(EMPTY_WEEKLY_REVIEW)).toBe(false);
    expect(weeklyReviewFilled({ ...EMPTY_WEEKLY_REVIEW, selfHarm: "no" })).toBe(true);
    expect(weeklyReviewFilled({ ...EMPTY_WEEKLY_REVIEW, sleep: "good" })).toBe(true);
    expect(weeklyReviewFilled({ ...EMPTY_WEEKLY_REVIEW, more: "  Pretend  " })).toBe(true);
    expect(weeklyReviewFilled({ ...EMPTY_WEEKLY_REVIEW, more: "   " })).toBe(false);
    expect(weeklyReviewKey({ ...FULL, proud: " Pretend finished a sketch " })).toBe(weeklyReviewKey(FULL));
    expect(weeklyReviewKey({ ...FULL, minDays: ["mon", "thu"] })).toBe(weeklyReviewKey(FULL));
    expect(weeklyReviewKey({ ...FULL, selfHarm: "no" })).not.toBe(weeklyReviewKey(FULL));
  });
  it("its fields: only the review's own, days in week order (nothing else carried)", () => {
    const f = weeklyReviewFields({ ...FULL, extra: "not kept" } as typeof FULL);
    expect(f).toEqual({ ...FULL, minDays: ["mon", "thu"] });
    expect("extra" in f).toBe(false);
  });
});
