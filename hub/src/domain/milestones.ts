// Milestones are flagged tasks (round 3: "milestones and completed tasks are kind of the
// same"). A legacy goal milestone becomes a linked task with a DETERMINISTIC id, so two
// devices converting the same goal write the same rows and sync merges them.

import type { Goal, ISODate, Item, Milestone } from "./types";

/** The server's limit on a row id. */
const MAX_ID = 128;

/** FNV-1a, 32 bit, as hex: only for ids too long to use as they are. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The task id for a goal's legacy milestone: the same on every device. */
export function milestoneTaskId(goalId: string, milestoneId: string): string {
  const raw = `ms-${goalId}-${milestoneId}`;
  return raw.length <= MAX_ID ? raw : `ms-${fnv(raw)}-${fnv(milestoneId + "|" + goalId)}`;
}

/**
 * The linked task for one legacy milestone: a to-do in the goal's area, flagged, done if
 * the milestone was done. Milestones never recorded when they were done, so a done one has
 * no completedAt (it then counts for overall progress, not for any month).
 */
export function milestoneTask(goal: Goal, m: Milestone, today: ISODate): Item {
  const item: Item = {
    id: milestoneTaskId(goal.id, m.id),
    kind: "task",
    title: m.title,
    links: [],
    areaId: goal.areaId,
    goalId: goal.id,
    milestone: true,
    priority: 2,
    status: m.done ? "done" : "open",
    createdAt: goal.createdAt,
    touchedAt: today,
  };
  return item;
}
