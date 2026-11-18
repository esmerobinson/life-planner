import { db } from "./db";
import { recordTodayFill, shouldRecord } from "./todayFillRepo";
import { todayFillRow, todayFillRowId } from "../domain/todayFill";
import { getDeviceId } from "../sync/engine";

// Today's picks, kept for the day in this device's synced prefs row (domain/todayFill.ts).

const TUE = "2026-10-27";
const WED = "2026-10-28";

beforeEach(async () => {
  await Promise.all([db.prefs.clear(), db.pending.clear(), db.syncMeta.clear()]);
});

describe("shouldRecord", () => {
  it("records the day's first picks, or a pick that filled a place never filled; nothing else", () => {
    expect(shouldRecord(undefined, { ids: ["a"], room: 4 })).toBe(true);
    // No picks at all (nothing loaded yet, or nothing to pick): nothing to keep.
    expect(shouldRecord(undefined, { ids: [], room: 4 })).toBe(false);
    expect(shouldRecord({ ids: ["a", "b"], room: 4 }, { ids: ["a", "b"], room: 4 })).toBe(false);
    expect(shouldRecord({ ids: ["a"], room: 4 }, { ids: ["a", "c"], room: 4 })).toBe(true);
  });
});

describe("recordTodayFill", () => {
  it("writes this device's row (synced: it is marked to send)", async () => {
    await recordTodayFill(TUE, { ids: ["a", "b"], room: 4 });
    const me = await getDeviceId(db);
    expect(await db.prefs.get(todayFillRowId(me))).toMatchObject({ date: TUE, ids: ["a", "b"], room: 4 });
    expect(await db.pending.get(["prefs", todayFillRowId(me)])).toBeDefined();
  });

  it("the same day: adds to what this device kept, keeping its room", async () => {
    await recordTodayFill(TUE, { ids: ["a"], room: 4 });
    await recordTodayFill(TUE, { ids: ["a", "c"], room: 3 });
    const me = await getDeviceId(db);
    expect(await db.prefs.get(todayFillRowId(me))).toMatchObject({ date: TUE, ids: ["a", "c"], room: 4 });
  });

  it("a new day replaces yesterday's row (one row per device, never more)", async () => {
    await recordTodayFill(TUE, { ids: ["a"], room: 4 });
    await recordTodayFill(WED, { ids: ["z"], room: 2 });
    const me = await getDeviceId(db);
    expect(await db.prefs.get(todayFillRowId(me))).toMatchObject({ date: WED, ids: ["z"], room: 2 });
    expect(await db.prefs.count()).toBe(1);
  });

  it("never touches another device's row", async () => {
    const other = todayFillRow("dev-other-0001", TUE, ["x"], 4);
    await db.prefs.put(other);
    await recordTodayFill(TUE, { ids: ["x", "y"], room: 4 });
    expect(await db.prefs.get(other.id)).toMatchObject({ ids: ["x"] });
  });
});
