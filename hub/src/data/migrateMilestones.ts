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
// - Ordinary tracked writes (stamped and marked pending), so the result syncs.

import { db as defaultDb, type HubDB } from "./db";
import { mergeBlocked, readSyncGate } from "./syncGate";
import { milestoneTask } from "../domain/milestones";
import type { ISODate } from "../domain/types";

/** Returns how many goals were converted (0 when blocked or nothing to do). */
export async function migrateMilestones(today: ISODate, db: HubDB = defaultDb): Promise<number> {
  return db.transaction("rw", db.items, db.goals, db.syncMeta, async () => {
    if (mergeBlocked(await readSyncGate(db.syncMeta))) return 0;
    const goals = (await db.goals.toArray()).filter((g) => g.status === undefined && g.milestones.length > 0);
    for (const goal of goals) {
      for (const m of goal.milestones) {
        const task = milestoneTask(goal, m, today);
        if (!(await db.items.get(task.id))) await db.items.add(task);
      }
      await db.goals.put({ ...goal, milestones: [] });
    }
    return goals.length;
  });
}
