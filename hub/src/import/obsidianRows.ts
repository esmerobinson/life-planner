import { isValidISODate } from "../domain/dates";
import { AREA_IDS, type Goal, type ISODate, type Item } from "../domain/types";
import type { Selection } from "./obsidianGoals";

const AREA_LIST: readonly string[] = AREA_IDS;

function checkArea(areaId: string, what: string) {
  if (!AREA_LIST.includes(areaId) || areaId === "inbox") throw new Error(`${what} needs an area other than the inbox`);
}

/**
 * Turns proposals into real rows (fresh ids, tasks linked to their goal's id). Pure:
 * nothing is written. Throws before building anything if a row is invalid: a finite
 * goal needs a real deadline, and no goal or task may be in the inbox.
 */
export function buildObsidianRows(selection: Selection, today: ISODate): { goals: Goal[]; items: Item[] } {
  for (const g of selection.goals) {
    if (!g.title.trim()) throw new Error("a goal needs a title");
    checkArea(g.areaId, "a goal");
    if (g.kind === "finite" && !(g.deadline && isValidISODate(g.deadline))) {
      throw new Error("finite goals need a deadline");
    }
  }
  for (const t of selection.tasks) {
    if (!t.title.trim()) throw new Error("a task needs a title");
    checkArea(t.areaId, "a task");
  }

  const goalIds = new Map<string, string>();
  const goals: Goal[] = [];
  for (const p of selection.goals) {
    if (goalIds.has(p.key)) continue;
    const goal: Goal = {
      id: crypto.randomUUID(),
      title: p.title.trim(),
      areaId: p.areaId,
      kind: p.kind,
      milestones: p.milestones.map((title) => ({ id: crypto.randomUUID(), title, done: false })),
      source: { kind: "obsidian", key: p.key },
      createdAt: today,
    };
    if (p.kind === "finite" && p.deadline) goal.deadline = p.deadline;
    if (p.why) goal.why = p.why;
    if (p.cadence) goal.cadence = p.cadence;
    if (p.notes) goal.notes = p.notes;
    goals.push(goal);
    goalIds.set(p.key, goal.id);
  }

  const seen = new Set<string>();
  const items: Item[] = [];
  for (const p of selection.tasks) {
    if (seen.has(p.key)) continue;
    seen.add(p.key);
    const item: Item = {
      id: crypto.randomUUID(),
      kind: "task",
      title: p.title.trim(),
      links: [],
      areaId: p.areaId,
      priority: 2,
      status: "open",
      createdAt: today,
      touchedAt: today,
      source: { kind: "obsidian", key: p.key },
    };
    const goalId = p.goalKey ? goalIds.get(p.goalKey) : undefined;
    if (goalId) item.goalId = goalId;
    if (p.recur) item.recur = p.recur;
    items.push(item);
  }
  return { goals, items };
}
