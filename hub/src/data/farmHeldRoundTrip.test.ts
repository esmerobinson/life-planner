// Bugs #47 and #48 together: a farm row this version holds for a later one goes into the backup
// (named in `farmHeld`), and that backup restores on this same version, the row held again (and
// sent once an update reads it, m5 c). A farm row the file doesn't name as held is from a newer
// version: NEWER_BACKUP. Fictional rows only.

import { db } from "./db";
import { exportBackup, NEWER_BACKUP, parseBackup, restoreBackup } from "./backup";
import { seenRow } from "../farm/state";

const later = { id: "coins:all", kind: "coins", n: 3, updatedAt: 10 };
beforeEach(async () => {
  await Promise.all([db.farm.clear(), db.quarantine.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear(), db.journal.clear()]);
});

it.each(["replace", "merge"] as const)("a backup holding a farm row kept for later restores here (%s): held again, counted as kept", async (mode) => {
  await db.farm.put(seenRow("hi", "2026-10-02"));
  await db.quarantine.put({ table: "farm", id: later.id, updatedAt: 10, data: later, reason: "pretend", cursor: 1 });
  const file = JSON.parse(JSON.stringify(await exportBackup("2026-11-05")));
  expect(file.farmHeld).toEqual(["coins:all"]);
  await db.quarantine.clear();
  if (mode === "replace") await db.farm.clear();
  expect(await restoreBackup(file, mode)).toMatchObject({ kept: 1 });
  expect(await db.farm.get("seen:hi")).toBeTruthy();
  expect(await db.farm.get("coins:all")).toBeUndefined();
  expect(await db.quarantine.get(["farm", "coins:all"])).toMatchObject({ updatedAt: 10, fromBackup: true });
});

it("a farm row of a kind this version has that doesn't check out is still damaged; one of a later kind not named held is NEWER", async () => {
  const base = JSON.parse(JSON.stringify(await exportBackup("2026-11-05")));
  expect(() => parseBackup({ ...base, farm: [later] })).toThrow(NEWER_BACKUP);
  expect(() => parseBackup({ ...base, farm: [{ id: "seen:x", kind: "seen", sticker: 5 }] })).toThrow("not an Esmeworld backup");
  expect(() => parseBackup({ ...base, farm: [later], farmHeld: ["coins:all"] })).not.toThrow();
});
