import { db } from "../data/db";
import { exportBackup, INVALID_BACKUP, parseBackup, restoreBackup } from "../data/backup";
import { hiddenRow, outfitRow, placedRow, seenRow, spotRow, startRow, visitedRow } from "./state";

// Esme's Farm is in backups and restores (review I6): the farm's start, what was seen and placed,
// arrivals and outfits come back with everything else. Fictional data.

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.goals.clear(), db.files.clear(), db.journal.clear(), db.farm.clear(), db.pending.clear()]);
});

it("a backup carries the farm, and a replace-restore brings it back exactly", async () => {
  await db.farm.bulkPut([
    startRow("dev-a", "2026-11-02"), seenRow("hi", "2026-11-02"), placedRow("hen", "hen", "2026-11-03"), outfitRow("bap", "A1"),
    visitedRow("lagoa-house", "2026-11-04"),
  ]);
  const file = await exportBackup("2026-11-05");
  expect(file.farm?.map((r) => r.id).sort()).toEqual(["outfit:bap", "placed:hen", "seen:hi", "start:dev-a", "visited:lagoa-house"]);
  await db.farm.clear();
  await db.farm.put(seenRow("door", "2026-11-04")); // not in the file: a replace removes it
  await restoreBackup(JSON.stringify(file), "replace");
  expect((await db.farm.toArray()).map((r) => r.id).sort()).toEqual(["outfit:bap", "placed:hen", "seen:hi", "start:dev-a", "visited:lagoa-house"]);
});

it("a merge-restore adds only the farm facts that are missing (this device's own stay)", async () => {
  await db.farm.bulkPut([startRow("dev-a", "2026-11-02"), outfitRow("bap", "A1"), visitedRow("fazenda", "2026-11-03")]);
  const file = await exportBackup("2026-11-05");
  await db.farm.clear();
  await db.farm.put(outfitRow("bap", "H4"));
  await restoreBackup(file, "merge");
  expect(await db.farm.get("outfit:bap")).toMatchObject({ item: "H4" });
  expect(await db.farm.get("start:dev-a")).toBeTruthy();
  expect(await db.farm.get("visited:fazenda")).toMatchObject({ area: "fazenda" });
});

it("an older backup with no farm leaves the farm as it is, even on replace", async () => {
  await db.farm.put(seenRow("hi", "2026-11-02"));
  const { farm: _f, ...older } = await exportBackup("2026-11-05");
  await restoreBackup(older, "replace");
  expect(await db.farm.get("seen:hi")).toBeTruthy();
});

it("a backup with an invalid farm row is refused whole", async () => {
  const file = await exportBackup("2026-11-05");
  expect(() => parseBackup({ ...file, farm: [{ id: "seen:hi", kind: "seen", sticker: "door", date: "2026-11-02" }] })).toThrow(INVALID_BACKUP);
});

it("a backup with a damaged visited row is refused whole", async () => {
  const file = await exportBackup("2026-11-05");
  expect(() => parseBackup({ ...file, farm: [{ id: "visited:fazenda", kind: "visited", area: "boteco", date: "2026-11-02" }] })).toThrow(INVALID_BACKUP);
});

it("hidden and moved stickers are in backups and come back on a replace or a merge (Esme's rule: never lose anything)", async () => {
  await db.farm.bulkPut([placedRow("hen", "rio", "2026-11-03"), hiddenRow("hen", true, "2026-11-17"), spotRow("cow", "cow-2", "2026-11-17")]);
  const file = await exportBackup("2026-11-18");
  expect(file.farm?.map((r) => r.id).sort()).toEqual(["hidden:hen", "placed:hen", "spot:cow"]);
  await db.farm.clear();
  await restoreBackup(JSON.stringify(file), "replace");
  expect(await db.farm.get("hidden:hen")).toMatchObject({ hidden: true });
  expect(await db.farm.get("spot:cow")).toMatchObject({ slot: "cow-2" });
  await db.farm.clear();
  await db.farm.put(hiddenRow("hen", false, "2026-11-19")); // this device showed it again: its own stays
  await restoreBackup(file, "merge");
  expect(await db.farm.get("hidden:hen")).toMatchObject({ hidden: false });
  expect(await db.farm.get("spot:cow")).toMatchObject({ slot: "cow-2" });
});

it("a backup with a damaged hidden or spot row is refused whole", async () => {
  const file = await exportBackup("2026-11-18");
  expect(() => parseBackup({ ...file, farm: [{ id: "hidden:hen", kind: "hidden", sticker: "hen", hidden: "yes", date: "2026-11-17" }] })).toThrow(INVALID_BACKUP);
  expect(() => parseBackup({ ...file, farm: [{ id: "spot:hen", kind: "spot", sticker: "cow", slot: "cow-2", date: "2026-11-17" }] })).toThrow(INVALID_BACKUP);
});
