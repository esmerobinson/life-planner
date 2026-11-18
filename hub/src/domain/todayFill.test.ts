import { describe, expect, it } from "vitest";
import { frozenFill, todayFillRow, todayFillRowId, validTodayFillRow, TODAY_FILL_PREFIX } from "./todayFill";
import { validPrefs } from "../reminders/duePrefs";

// Today's list stops refilling (Esme, 2026-11-06: removing a task from Today "just constantly
// gets replaced with another"). The day's picks are kept in a small synced row per device.

const TUE = "2026-10-27";

describe("today-fill rows", () => {
  it("a row per device, holding the day, the picked ids and the room there was", () => {
    const row = todayFillRow("dev-aaaa1111", TUE, ["a", "b"], 3);
    expect(row).toEqual({ id: `${TODAY_FILL_PREFIX}dev-aaaa1111`, date: TUE, ids: ["a", "b"], room: 3 });
    expect(todayFillRowId("dev-aaaa1111")).toBe("today-fill:dev-aaaa1111");
    expect(validTodayFillRow(row)).toBe(true);
    expect(validPrefs(row)).toBe(true);
  });

  it("refuses malformed rows", () => {
    const ok = todayFillRow("dev-aaaa1111", TUE, ["a"], 4);
    expect(validTodayFillRow({ ...ok, date: "2026-02-30" })).toBe(false);
    expect(validTodayFillRow({ ...ok, ids: "a" })).toBe(false);
    expect(validTodayFillRow({ ...ok, ids: [1] })).toBe(false);
    expect(validTodayFillRow({ ...ok, ids: [""] })).toBe(false);
    expect(validTodayFillRow({ ...ok, ids: Array.from({ length: 51 }, (_, k) => `x${k}`) })).toBe(false);
    expect(validTodayFillRow({ ...ok, room: -1 })).toBe(false);
    expect(validTodayFillRow({ ...ok, room: 1.5 })).toBe(false);
    expect(validTodayFillRow({ ...ok, id: "today-fill:" })).toBe(false);
    expect(validTodayFillRow({ ...ok, updatedAt: "now" })).toBe(false);
    expect(validTodayFillRow({ ...ok, updatedAt: 5 })).toBe(true);
    expect(validPrefs({ ...ok, ids: "a" })).toBe(false);
  });
});

describe("frozenFill: today's picks from every device's row", () => {
  it("no row for today: nothing is frozen yet (a new day starts fresh)", () => {
    expect(frozenFill([], TUE)).toBeUndefined();
    expect(frozenFill([todayFillRow("dev-aaaa1111", "2026-10-26", ["a"], 4)], TUE)).toBeUndefined();
  });

  it("one device: its ids and room", () => {
    expect(frozenFill([todayFillRow("dev-aaaa1111", TUE, ["a", "b"], 4)], TUE)).toEqual({ ids: ["a", "b"], room: 4 });
  });

  it("two devices picked today before syncing: both lists count, nothing she saw is dropped", () => {
    const rows = [todayFillRow("dev-bbbb2222", TUE, ["c", "a"], 3), todayFillRow("dev-aaaa1111", TUE, ["a", "b"], 4)];
    expect(frozenFill(rows, TUE)).toEqual({ ids: ["a", "b", "c"], room: 4 });
  });

  it("ignores rows that are not today-fill rows or are malformed", () => {
    const rows = [{ id: "due", on: true }, { ...todayFillRow("dev-aaaa1111", TUE, ["a"], 4), ids: "a" }];
    expect(frozenFill(rows, TUE)).toBeUndefined();
  });
});
