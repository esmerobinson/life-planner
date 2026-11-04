import { db } from "../data/db";
import { ensureStart, markArrived, markSeen, placeSticker, recordTodayDone, setOutfit } from "./farmRepo";
import { farmState } from "./state";

beforeEach(async () => {
  await db.farm.clear();
  await db.pending.clear();
});

const state = async () => farmState(await db.farm.toArray());

it("the start is set once, on the first open", async () => {
  await ensureStart("2026-11-04");
  await ensureStart("2026-11-09");
  expect((await state()).start).toBe("2026-11-04");
  expect(await db.farm.where("kind").equals("start").count()).toBe(1);
});

it("placing a sticker puts it at its fixed spot and counts it as seen; placing again changes nothing", async () => {
  await placeSticker("hen", "2026-11-05");
  const before = await db.farm.get("placed:hen");
  await placeSticker("hen", "2026-11-09");
  const s = await state();
  expect(s.placed.get("hen")).toBe("hen");
  expect(s.seen.has("hen")).toBe(true);
  expect(await db.farm.get("placed:hen")).toEqual(before);
});

it("unknown stickers are never written", async () => {
  await placeSticker("unicorn", "2026-11-05");
  await markSeen("unicorn", "2026-11-05");
  expect(await db.farm.count()).toBe(0);
});

it("seen, arrivals, outfits and finished Today days, each a synced change", async () => {
  await markSeen("hi", "2026-11-04");
  await markSeen("hi", "2026-11-05");
  await markArrived("bap", "2026-11-05");
  await setOutfit("bap", "H4");
  await setOutfit("bap", null);
  await recordTodayDone("2026-11-05");
  await recordTodayDone("2026-11-05");
  const s = await state();
  expect(await db.farm.get("seen:hi")).toMatchObject({ date: "2026-11-04" });
  expect(s.arrived.has("bap")).toBe(true);
  expect(s.outfits.get("bap")).toBeNull();
  expect(s.todayDone).toEqual(["2026-11-05"]);
  expect(await db.pending.where("table").equals("farm").count()).toBe(4);
});
