import { checkedIn, checkinDoneDays, exerciseDoneDays, journalRowDays, lastSevenDays, rowStatus, type CheckinDayLike } from "./rows";

const set = (...d: string[]) => new Set(d);

describe("journal rows: done today and the streak", () => {
  it("today done: ticked, and the run counts back from today", () => {
    expect(rowStatus(set("2026-10-31", "2026-11-01", "2026-11-02"), "2026-11-02")).toMatchObject({ done: true, streak: 3 });
  });

  it("today not done yet: not ticked, but the run ending yesterday still shows", () => {
    expect(rowStatus(set("2026-10-31", "2026-11-01"), "2026-11-02")).toMatchObject({ done: false, streak: 2 });
  });

  it("a gap breaks the run; nothing yesterday or today is 0", () => {
    expect(rowStatus(set("2026-10-28", "2026-10-29", "2026-10-31", "2026-11-01", "2026-11-02"), "2026-11-02").streak).toBe(3);
    expect(rowStatus(set("2026-10-29", "2026-10-30"), "2026-11-02")).toMatchObject({ done: false, streak: 0 });
    expect(rowStatus(set(), "2026-11-02")).toMatchObject({ done: false, streak: 0 });
  });

  it("only today done is a streak of 1", () => {
    expect(rowStatus(set("2026-11-02"), "2026-11-02")).toMatchObject({ done: true, streak: 1 });
  });

  it("runs across month and year boundaries (and a leap day)", () => {
    expect(rowStatus(set("2026-10-30", "2026-10-31", "2026-11-01"), "2026-11-01").streak).toBe(3);
    expect(rowStatus(set("2026-12-30", "2026-12-31", "2027-01-01"), "2027-01-02")).toMatchObject({ done: false, streak: 3 });
    expect(rowStatus(set("2028-02-28", "2028-02-29", "2028-03-01"), "2028-03-01").streak).toBe(3);
    expect(rowStatus(set("2027-02-28", "2027-03-01"), "2027-03-01").streak).toBe(2);
  });

  it("future days don't count", () => {
    expect(rowStatus(set("2026-11-03", "2026-11-04"), "2026-11-02")).toMatchObject({ done: false, streak: 0 });
  });
});

const day = (date: string, prompts: string[], done: Record<string, boolean>): CheckinDayLike => ({
  date,
  prompts,
  answers: new Map(Object.entries(done).map(([p, d]) => [p, { done: d }])),
});

describe("journal rows: this week's bars and this month's count", () => {
  it("the last seven days, oldest first, ending today", () => {
    expect(lastSevenDays(set("2026-10-27", "2026-10-30", "2026-11-02", "2026-10-26"), "2026-11-02")).toEqual([
      true, false, false, true, false, false, true,
    ]);
    expect(lastSevenDays(set(), "2026-11-02")).toEqual([false, false, false, false, false, false, false]);
  });

  it("a row's status carries the week and the days done this month", () => {
    const s = rowStatus(set("2026-10-31", "2026-11-01", "2026-11-02"), "2026-11-02");
    expect(s.week).toEqual([false, false, false, false, true, true, true]);
    expect(s.month).toBe(2);
  });
});

describe("journal rows: check-in done", () => {
  it("is checked in once every question was moved past", () => {
    expect(checkedIn(day("2026-11-02", ["a", "b", "c"], { a: true, b: true, c: true }))).toBe(true);
  });

  it("is not checked in part way, or with no questions at all", () => {
    expect(checkedIn(day("2026-11-02", ["a", "b", "c"], { a: true, b: true }))).toBe(false);
    expect(checkedIn(day("2026-11-02", ["a", "b"], { a: true, b: false }))).toBe(false);
    expect(checkedIn(day("2026-11-02", [], {}))).toBe(false);
  });

  it("collects the checked-in days", () => {
    const days = [
      day("2026-11-02", ["a"], { a: false }),
      day("2026-11-01", ["a", "b"], { a: true, b: true }),
      day("2026-10-31", ["a"], { a: true }),
    ];
    expect(checkinDoneDays(days)).toEqual(set("2026-11-01", "2026-10-31"));
  });
});

describe("journal rows: exercise done", () => {
  it("a day counts when any device marked its card done", () => {
    const marks = [
      { date: "2026-11-02", device: "d1", id: "day-4", done: false, primary: true },
      { date: "2026-11-01", device: "d1", id: "day-3", done: false, primary: true },
      { date: "2026-11-01", device: "d2", id: "day-3", done: true, primary: true },
      { date: "2026-10-31", device: "d1", id: "day-2", done: true, primary: true },
      { date: "2026-10-30", device: "d1", id: "day-9", done: true, primary: false }, // a further card that day
    ];
    expect(exerciseDoneDays(marks)).toEqual(set("2026-11-01", "2026-10-31", "2026-10-30"));
  });
});

describe("journalRowDays (goals: Journal daily, fix round 1)", () => {
  it("a page day, a finished check-in day and an exercise day; an unfinished check-in and a shown card don't count", () => {
    const answers = (done: boolean) => new Map([["K2", { done }]]);
    const days = journalRowDays(
      set("2026-11-01"),
      [
        { date: "2026-10-31", prompts: ["K2"], answers: answers(true) },
        { date: "2026-11-02", prompts: ["K2", "K4"], answers: answers(true) }, // K4 not reached
      ],
      [
        { date: "2026-10-30", device: "d1", id: "day-1", done: true, primary: true },
        { date: "2026-10-29", device: "d1", id: "day-2", done: false, primary: true }, // shown, not done
      ],
    );
    expect(days).toEqual(set("2026-11-01", "2026-10-31", "2026-10-30"));
  });
});
