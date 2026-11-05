/*
 * Testing session (everyday walkthrough), repeating to-dos. FICTIONAL data only.
 *
 * What Esme sees: she ticks her "Pretend stretch" habit, then (same day) opens it and presses
 * Stop repeating, so it moves to "Done today". She changes her mind about the tick and
 * unticks it there: it is an open, unticked one-off now. Later she presses Repeat again.
 * The habit comes back already ticked, "Done for today", although she unticked it, and
 * the area's "ticked off in November" count still counted it while it sat there unticked.
 * Cause: stopRepeating (data/repo.ts:773) turns today's habit tick into a completion but
 * keeps today in doneDates; untickItem (data/repo.ts:219) on the one-off only clears
 * completedAt, so today stays in doneDates, which tickOffDates and doneToday read.
 */
import { db } from "../data/db";
import { createItem, repeatAgain, stopRepeating, tickItem, untickItem } from "../data/repo";
import { doneToday } from "./habits";
import { tickedOff } from "./progress";

const TODAY = "2026-11-04";
const EVERY_DAY = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

beforeEach(async () => {
  await db.items.clear();
});

describe("Testing: tick, Stop repeating, untick, Repeat again (all on one day)", () => {
  it("an unticked one-off is not counted as ticked off, and Repeat again brings the habit back unticked", async () => {
    const it0 = await createItem({ kind: "task", title: "Pretend stretch", areaId: "body", priority: 2, recur: [...EVERY_DAY] }, TODAY);
    await tickItem(it0.id, TODAY);
    await stopRepeating(it0.id, TODAY); // now a done one-off, completed today (as designed)
    await untickItem(it0.id, TODAY); // she unticks it in Done today

    const oneOff = (await db.items.get(it0.id))!;
    expect(oneOff.status).toBe("open");
    // Nothing is ticked in Body today, so nothing should count as ticked off.
    expect(tickedOff("body", [oneOff], TODAY).thisMonth).toBe(0);

    await repeatAgain(it0.id, TODAY);
    const habit = (await db.items.get(it0.id))!;
    expect(habit.recur).toEqual([...EVERY_DAY]);
    // Expected: unticked, as she left it. Actual: "Done for today".
    expect(doneToday(habit, TODAY)).toBe(false);
  });
});
