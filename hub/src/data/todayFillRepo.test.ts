import { db } from "./db";
import {
  OWN_FILL_META, daySeenAt, forgetDaysSeen, markTodayTouched, pruneTodayFill, recordTodayFill, shouldRecord, syncGate,
} from "./todayFillRepo";
import { firstWinsStamp, todayFillRow, todayFillRowId } from "../domain/todayFill";
import { keepOwnStamps } from "./changeTracking";

// Today's picks, kept for the day in ONE shared synced row (domain/todayFill.ts), plus this
// device's own copy of the list it shows (syncMeta). Fix round 1: I1, I2, I3, minors.

const TUE = "2026-10-27";
const WED = "2026-10-28";
const AT_8 = Date.UTC(2026, 9, 27, 12);
const AT_10 = AT_8 + 2 * 3600_000;
const ID = todayFillRowId(TUE);

beforeEach(async () => {
  await Promise.all([db.prefs.clear(), db.pending.clear(), db.syncMeta.clear()]);
  forgetDaysSeen();
});

const own = async () => (await db.syncMeta.get(OWN_FILL_META))?.value;

/** Another device's row arriving by sync (its own stamp). */
async function arrives(date: string, ids: string[], room: number, pickedAt: number) {
  await db.transaction("rw", db.prefs, async () => {
    keepOwnStamps();
    await db.prefs.put({ ...todayFillRow(date, { ids, room }, pickedAt), updatedAt: firstWinsStamp(date, pickedAt, ids.length) });
  });
}

describe("shouldRecord", () => {
  it("the day's first picks are always kept, even none at all (I1); then only a newly filled place", () => {
    expect(shouldRecord(undefined, { ids: ["a"], room: 4 })).toBe(true);
    expect(shouldRecord(undefined, { ids: [], room: 0 })).toBe(true);
    expect(shouldRecord({ ids: ["a", "b"], room: 4 }, { ids: ["a", "b"], room: 4 })).toBe(false);
    expect(shouldRecord({ ids: ["a"], room: 4 }, { ids: ["a", "c"], room: 4 })).toBe(true);
  });
});

describe("recordTodayFill", () => {
  it("writes the day's one shared row with the first-wins stamp (synced), and this device's copy", async () => {
    await recordTodayFill(TUE, { ids: ["a", "b"], room: 4 }, AT_8);
    const row = await db.prefs.get(ID);
    expect(row).toMatchObject({ date: TUE, ids: ["a", "b"], room: 4, pickedAt: AT_8, updatedAt: firstWinsStamp(TUE, AT_8, 2) });
    expect(await db.pending.get(["prefs", ID])).toMatchObject({ updatedAt: firstWinsStamp(TUE, AT_8, 2) });
    expect(await own()).toEqual({ date: TUE, ids: ["a", "b"], room: 4, touched: false });
  });

  it("I1: a day with no places is kept too (nothing picked)", async () => {
    await recordTodayFill(TUE, { ids: [], room: 0 }, AT_8);
    expect(await db.prefs.get(ID)).toMatchObject({ ids: [], room: 0 });
  });

  it("a place never filled: added to the same row, keeping when it was first picked (its stamp goes up by one)", async () => {
    await recordTodayFill(TUE, { ids: ["a"], room: 4 }, AT_8);
    await recordTodayFill(TUE, { ids: ["a", "c"], room: 3 }, AT_10);
    expect(await db.prefs.get(ID)).toMatchObject({ ids: ["a", "c"], room: 4, pickedAt: AT_8, updatedAt: firstWinsStamp(TUE, AT_8, 2) });
  });

  it("never more picks than places, even when two records overlap (to-dos arriving while Home is open)", async () => {
    await recordTodayFill(TUE, { ids: ["a", "b"], room: 3 }, AT_8);
    await Promise.all([recordTodayFill(TUE, { ids: ["a", "c"], room: 3 }, AT_8), recordTodayFill(TUE, { ids: ["a", "d"], room: 3 }, AT_8)]);
    const row = (await db.prefs.get(ID)) as { ids: string[]; room: number };
    expect(row.room).toBe(3);
    expect(row.ids).toHaveLength(3);
    expect(row.ids.slice(0, 2)).toEqual(["a", "b"]);
  });

  it("I3: an earlier device's row already here: its places are filled into it, never past its room", async () => {
    await arrives(TUE, ["x"], 2, AT_8);
    await recordTodayFill(TUE, { ids: ["x", "y", "z"], room: 4 }, AT_10);
    expect(await db.prefs.get(ID)).toMatchObject({ ids: ["x", "y"], room: 2, pickedAt: AT_8 });
  });

  it("I3: once she has used Today here, a place filled later goes into this device's copy only", async () => {
    await recordTodayFill(TUE, { ids: ["c"], room: 2 }, AT_10);
    await markTodayTouched(TUE, { ids: ["c"], room: 2 });
    await arrives(TUE, ["a", "b"], 2, AT_8); // an earlier device's row wins the shared row
    await recordTodayFill(TUE, { ids: ["c", "d"], room: 2 }, AT_10 + 1);
    expect(await own()).toEqual({ date: TUE, ids: ["c", "d"], room: 2, touched: true });
    expect(await db.prefs.get(ID)).toMatchObject({ ids: ["a", "b"], pickedAt: AT_8 });
  });

  it("a new day: a new row (yesterday's stays until pruned), and a fresh copy", async () => {
    await recordTodayFill(TUE, { ids: ["a"], room: 4 }, AT_8);
    await markTodayTouched(TUE, { ids: ["a"], room: 4 });
    await recordTodayFill(WED, { ids: ["z"], room: 2 }, AT_8 + 86_400_000);
    expect(await db.prefs.get(todayFillRowId(WED))).toMatchObject({ ids: ["z"], room: 2 });
    expect(await own()).toEqual({ date: WED, ids: ["z"], room: 2, touched: false });
  });
});

describe("markTodayTouched", () => {
  it("keeps the list she is working from as this device's copy, once a day", async () => {
    await markTodayTouched(TUE, { ids: ["a", "b"], room: 2 });
    expect(await own()).toEqual({ date: TUE, ids: ["a", "b"], room: 2, touched: true });
    await markTodayTouched(TUE, { ids: ["other"], room: 1 });
    expect(await own()).toEqual({ date: TUE, ids: ["a", "b"], room: 2, touched: true });
  });
});

describe("pruneTodayFill", () => {
  it("removes this device's rows for days more than 14 days ago (and anything waiting to send them)", async () => {
    await recordTodayFill("2026-10-12", { ids: ["old"], room: 4 }, Date.UTC(2026, 9, 12, 12));
    await recordTodayFill("2026-10-13", { ids: ["keep"], room: 4 }, Date.UTC(2026, 9, 13, 12));
    await recordTodayFill(TUE, { ids: ["a"], room: 4 }, AT_8);
    await pruneTodayFill(TUE);
    expect(await db.prefs.get(todayFillRowId("2026-10-12"))).toBeUndefined();
    expect(await db.pending.get(["prefs", todayFillRowId("2026-10-12")])).toBeUndefined();
    expect(await db.prefs.get(todayFillRowId("2026-10-13"))).toBeDefined();
    expect(await db.prefs.get(ID)).toBeDefined();
  });
});

describe("I2: the sync gate", () => {
  it("the day is first seen once per app session", () => {
    const first = daySeenAt(TUE, AT_8);
    expect(daySeenAt(TUE, AT_10)).toBe(first);
    expect(daySeenAt(WED, AT_10)).toBe(AT_10);
  });

  it("sync off: publish at once; offline before the day's full sync: keep locally only (R-I1); else wait", () => {
    const base = { token: true, firstPull: true, lastFullSyncAt: AT_8 - 1, online: true, daySeen: AT_8 };
    expect(syncGate({ ...base, token: false, firstPull: false, lastFullSyncAt: undefined })).toBe("publish");
    expect(syncGate({ ...base, online: false })).toBe("local");
    expect(syncGate(base)).toBe("wait");
    expect(syncGate({ ...base, firstPull: false, lastFullSyncAt: AT_10 })).toBe("wait");
    expect(syncGate({ ...base, lastFullSyncAt: AT_10 })).toBe("publish");
    // Once the day's full sync is in, offline later in the day still publishes (it goes out next sync).
    expect(syncGate({ ...base, lastFullSyncAt: AT_10, online: false })).toBe("publish");
  });
});

describe("R-I1: picks made offline stay on this device until the day's full sync", () => {
  const AT_7 = AT_8 - 3600_000;
  const AT_9 = AT_8 + 3600_000;

  it("offline: kept as this device's own copy only, no shared row", async () => {
    await recordTodayFill(TUE, { ids: ["stale"], room: 1 }, AT_7, db, "local");
    expect(await db.prefs.get(ID)).toBeUndefined();
    expect(await own()).toEqual({ date: TUE, ids: ["stale"], room: 1, touched: false, unpublished: true });
    // Never past its places, locally too.
    await recordTodayFill(TUE, { ids: ["stale", "x"], room: 1 }, AT_7, db, "local");
    expect(await own()).toMatchObject({ ids: ["stale"] });
  });

  it("she uses Today while offline: still to publish", async () => {
    await recordTodayFill(TUE, { ids: ["a"], room: 4 }, AT_7, db, "local");
    await markTodayTouched(TUE, { ids: ["a"], room: 4 });
    expect(await own()).toEqual({ date: TUE, ids: ["a"], room: 4, touched: true, unpublished: true });
    await recordTodayFill(TUE, { ids: ["a"], room: 4 }, AT_9, db, "publish");
    expect(await db.prefs.get(ID)).toMatchObject({ ids: ["a"], pickedAt: AT_9 });
    expect(await own()).toEqual({ date: TUE, ids: ["a"], room: 4, touched: true });
  });

  it("back online, no other device's row: published, stamped from when it was published (not picked)", async () => {
    await recordTodayFill(TUE, { ids: ["a"], room: 4 }, AT_7, db, "local");
    await recordTodayFill(TUE, { ids: ["a"], room: 4 }, AT_9, db, "publish");
    expect(await db.prefs.get(ID)).toMatchObject({ ids: ["a"], room: 4, pickedAt: AT_9, updatedAt: firstWinsStamp(TUE, AT_9, 1) });
    expect(await own()).toEqual({ date: TUE, ids: ["a"], room: 4, touched: false });
  });

  it("back online, another device's row arrived: adopted (she hadn't used Today here); nothing published", async () => {
    await recordTodayFill(TUE, { ids: ["stale"], room: 1 }, AT_7, db, "local");
    await arrives(TUE, ["m1", "m2", "m3", "m4"], 4, AT_8);
    await recordTodayFill(TUE, { ids: ["stale"], room: 1 }, AT_9, db, "publish");
    expect(await db.prefs.get(ID)).toMatchObject({ ids: ["m1", "m2", "m3", "m4"], pickedAt: AT_8 });
    expect(await own()).toEqual({ date: TUE, ids: ["m1", "m2", "m3", "m4"], room: 4, touched: false });
    expect(await db.prefs.get(ID)).toMatchObject({ updatedAt: firstWinsStamp(TUE, AT_8, 4) }); // untouched
  });

  it("back online, another device's row arrived, she HAD used Today here: hers stays on this device, nothing published", async () => {
    await recordTodayFill(TUE, { ids: ["stale"], room: 1 }, AT_7, db, "local");
    await markTodayTouched(TUE, { ids: ["stale"], room: 1 });
    await arrives(TUE, ["m1", "m2"], 2, AT_8);
    await recordTodayFill(TUE, { ids: ["stale"], room: 1 }, AT_9, db, "publish");
    expect(await db.prefs.get(ID)).toMatchObject({ ids: ["m1", "m2"], pickedAt: AT_8 });
    expect(await own()).toEqual({ date: TUE, ids: ["stale"], room: 1, touched: true });
    expect(await db.prefs.get(ID)).toMatchObject({ updatedAt: firstWinsStamp(TUE, AT_8, 2) }); // untouched
  });
});
