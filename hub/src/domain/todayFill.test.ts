import { describe, expect, it } from "vitest";
import {
  effectiveFill, firstWinsStamp, todayFillRow, todayFillRowId, validTodayFillRow, PRUNE_AFTER_DAYS, TODAY_FILL_PREFIX,
} from "./todayFill";
import { validPrefs } from "../reminders/duePrefs";

// Today's list stops refilling (Esme, 2026-11-06; confirmed 2026-11-18: ticking off must not
// bring a new one in either). ONE shared row per day holds the day's picks (fix round 1, I3).

const TUE = "2026-10-27";
const AT_8 = Date.UTC(2026, 9, 27, 12); // 8am in New York
const AT_10 = AT_8 + 2 * 3600_000;

describe("the day's row", () => {
  it("one row per day: the day, the picks, the places there were, when they were picked", () => {
    const row = todayFillRow(TUE, { ids: ["a", "b"], room: 3, dues: { b: "2026-10-28" } }, AT_8);
    expect(row).toEqual({ id: `${TODAY_FILL_PREFIX}${TUE}`, date: TUE, ids: ["a", "b"], room: 3, dues: { b: "2026-10-28" }, pickedAt: AT_8 });
    expect(todayFillRowId(TUE)).toBe("today-fill:2026-10-27");
    expect(validTodayFillRow(row)).toBe(true);
    expect(validPrefs(row)).toBe(true);
  });

  it("a day with no places (the list full of things due) is a row too, with nothing picked (I1)", () => {
    const row = todayFillRow(TUE, { ids: [], room: 0 }, AT_8);
    expect(validTodayFillRow(row)).toBe(true);
  });

  it("refuses malformed rows, and never more picks than places (M2)", () => {
    const ok = todayFillRow(TUE, { ids: ["a"], room: 4 }, AT_8);
    expect(validTodayFillRow({ ...ok, id: "today-fill:2026-10-28" })).toBe(false); // id and day must match
    expect(validTodayFillRow({ ...ok, date: "2026-02-30", id: "today-fill:2026-02-30" })).toBe(false);
    expect(validTodayFillRow({ ...ok, ids: "a" })).toBe(false);
    expect(validTodayFillRow({ ...ok, ids: [1] })).toBe(false);
    expect(validTodayFillRow({ ...ok, ids: [""] })).toBe(false);
    expect(validTodayFillRow({ ...ok, ids: ["a", "b"], room: 1 })).toBe(false);
    expect(validTodayFillRow({ ...ok, room: -1 })).toBe(false);
    expect(validTodayFillRow({ ...ok, room: 1.5 })).toBe(false);
    expect(validTodayFillRow({ ...ok, pickedAt: 0 })).toBe(false);
    expect(validTodayFillRow({ ...ok, dues: { a: "soon" } })).toBe(false);
    expect(validTodayFillRow({ ...ok, dues: { z: "2026-10-28" } })).toBe(false); // only for its picks
    expect(validTodayFillRow({ ...ok, updatedAt: "now" })).toBe(false);
    expect(validTodayFillRow({ ...ok, updatedAt: 5 })).toBe(true);
    expect(validPrefs({ ...ok, ids: "a" })).toBe(false);
  });

  it("first picked wins on every device: an earlier pick has the larger sync stamp, never one in the future", () => {
    const early = firstWinsStamp(TUE, AT_8, 0);
    const late = firstWinsStamp(TUE, AT_10, 0);
    expect(early).toBeGreaterThan(late);
    expect(early).toBeLessThan(AT_8);
    expect(late).toBeGreaterThan(0);
    // Its own later additions (a place never filled) beat its own earlier copy.
    expect(firstWinsStamp(TUE, AT_8, 1)).toBeGreaterThan(early);
    // Even across time zones (her day starts at 3am wherever she is), never in the future.
    expect(firstWinsStamp(TUE, Date.UTC(2026, 9, 26, 13), 0)).toBeLessThan(Date.UTC(2026, 9, 26, 13));
  });

  it("rows older than two weeks are pruned", () => {
    expect(PRUNE_AFTER_DAYS).toBe(14);
  });
});

describe("effectiveFill: the list this device shows", () => {
  const shared = todayFillRow(TUE, { ids: ["a", "b"], room: 2 }, AT_8);
  it("none yet: nothing is kept (a new day starts fresh)", () => {
    expect(effectiveFill(undefined, undefined, TUE)).toBeUndefined();
    expect(effectiveFill(todayFillRow("2026-10-26", { ids: ["a"], room: 4 }, AT_8), undefined, TUE)).toBeUndefined();
  });
  it("the shared row", () => {
    expect(effectiveFill(shared, undefined, TUE)).toEqual({ ids: ["a", "b"], room: 2 });
  });
  it("its own copy once she has used Today here, even when an earlier device's row arrives (I3)", () => {
    const own = { date: TUE, ids: ["c", "d"], room: 2, touched: true };
    expect(effectiveFill(shared, own, TUE)).toEqual({ ids: ["c", "d"], room: 2 });
    // Not used yet: the earlier device's row is adopted.
    expect(effectiveFill(shared, { ...own, touched: false }, TUE)).toEqual({ ids: ["a", "b"], room: 2 });
    // Yesterday's copy never counts.
    expect(effectiveFill(shared, { ...own, date: "2026-10-26" }, TUE)).toEqual({ ids: ["a", "b"], room: 2 });
  });
});
