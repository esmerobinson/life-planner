// One-time conversion of goals' legacy milestone lists into flagged linked tasks (round 3).
//
// - Idempotent: a goal is converted only while its `milestones` list is non-empty, and a
//   task that already exists (same deterministic id, e.g. from another device) is left as
//   it is. Safe to run on every start and after every sync; it writes nothing when there is
//   nothing to convert. Running it again also converts milestones that arrive later from an
//   older app version on another device.
// - Never runs while sync is on and this device has not finished its first full pull (the
//   same gate as Merge and the importers): until then this device does not know what the
//   server already has, e.g. goals another device has already converted.
// - Goals in the Bin are skipped (their tasks would show in the area); a restored goal is
//   converted on the next run.
// - Tracked writes (marked pending, so the result syncs) that keep OLD stamps derived from
//   the goal's own, so a late migration never overwrites edits made elsewhere (see below).
// - Each task keeps its milestone's position as `order`, so the steps stay in sequence.

import { db as defaultDb, type HubDB } from "./db";
import { keepOwnStamps, legacyStamp } from "./changeTracking";
import { mergeBlocked, readSyncGate } from "./syncGate";
import { milestoneTask } from "../domain/milestones";
import type { ISODate } from "../domain/types";

/** Returns how many goals were converted (0 when blocked or nothing to do). */
export async function migrateMilestones(today: ISODate, db: HubDB = defaultDb): Promise<number> {
  // The common case (nothing left to convert) is a plain read: no write lock taken.
  const anyLeft = (await db.goals.toArray()).some((g) => g.status === undefined && g.milestones.length > 0);
  if (!anyLeft) return 0;
  return db.transaction("rw", db.items, db.goals, db.syncMeta, async () => {
    // Old stamps, never "now" (review C-1): a device that migrates late (offline, or before
    // its first sync of the session) must never win over edits made elsewhere since. Each
    // new task carries the stamp of the goal version it came from, so any copy another
    // device already migrated (and maybe edited, ticked or binned) wins; the cleared goal
    // beats only that exact version (stamp + 1), so a later rename or delete elsewhere wins.
    keepOwnStamps();
    if (mergeBlocked(await readSyncGate(db.syncMeta))) return 0;
    const goals = (await db.goals.toArray()).filter((g) => g.status === undefined && g.milestones.length > 0);
    for (const goal of goals) {
      const base = legacyStamp(goal);
      for (const [index, m] of goal.milestones.entries()) {
        const task = milestoneTask(goal, m, today, index);
        if (!(await db.items.get(task.id))) await db.items.add({ ...task, updatedAt: base });
      }
      await db.goals.put({ ...goal, milestones: [], updatedAt: base + 1 });
    }
    return goals.length;
  });
}
