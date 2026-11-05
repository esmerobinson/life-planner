// Testing session (everyday walkthrough, goals). This test FAILS on purpose: it shows a bug.
//
// What Esme would see: a daily goal (e.g. "Draw every day") with a January count of
// "Days drawn 30 / 30" (nearly every day of a 31-day month). On 1 February she taps
// "Plan February": the new count is "0 / 30", but February only has 28 days, so the month can
// never be hit and its dot is a miss whatever she does. ("Every day" targets are adjusted to
// the new month's length; any other target is copied as it is, even when it is more days than
// the month has.)
import { daysInMonth, plannedFromLastMonth } from "./goalCounts";
import type { Goal } from "./types";

describe("Testing: Plan <month> on a daily goal", () => {
  it("a daily goal's planned count is never more days than the new month has (Jan 30 -> Feb)", () => {
    const goal: Goal = {
      id: "g1", title: "Draw every pretend day", areaId: "art", kind: "practice", rhythm: "daily", milestones: [],
      createdAt: "2027-01-01",
      monthGoals: [{ id: "m1", month: "2027-01", kind: "count", title: "Days drawn", target: 30 }],
    };
    let n = 0;
    const plan = plannedFromLastMonth(goal, "2027-02-01", () => `new-${n++}`);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.target).toBeLessThanOrEqual(daysInMonth("2027-02"));
  });
});
