import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import {
  addRoutineStep, applySuggestedLinks, linkRoutineStep, moveRoutineStep, readRoutine, removeRoutineStep, setRoutineStepDone,
  updateRoutineStep,
} from "./dailyRoutineRepo";
import { tickItem } from "./repo";
import { routineDay, routineSteps, stepRowId, tickRowId } from "../domain/dailyRoutine";
import type { Item } from "../domain/types";

// "Today's routine" on Home: reads and writes (synced `prefs` rows). All data is fictional.

const TODAY = "2026-11-17";
const habit = (id: string, title: string, extra: Partial<Item> = {}): Item => ({
  id, kind: "task", title, links: [], areaId: "mind", priority: 2, status: "open",
  createdAt: "2026-11-01", touchedAt: "2026-11-01", recur: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], ...extra,
});

beforeEach(async () => {
  await Promise.all([db.prefs.clear(), db.items.clear(), db.pending.clear()]);
});

async function view(today = TODAY) {
  const { steps, ticks } = await readRoutine(today);
  return routineDay(routineSteps(steps), await db.items.toArray(), ticks, today);
}

describe("ticking a step", () => {
  it("an unlinked step keeps its own tick for the day, synced, and unticks again", async () => {
    await setRoutineStepDone("d2", TODAY, true);
    expect(await db.prefs.get(tickRowId(TODAY, "d2"))).toMatchObject({ date: TODAY, step: "d2", done: true });
    expect(await db.pending.get(["prefs", tickRowId(TODAY, "d2")])).toBeTruthy(); // goes to the server
    expect((await view()).done).toBe(1);
    await setRoutineStepDone("d2", TODAY, false);
    expect((await view()).done).toBe(0);
  });

  it("starts fresh the next day", async () => {
    await setRoutineStepDone("d2", TODAY, true);
    expect((await view("2026-11-18")).done).toBe(0);
  });

  it("a linked step ticks its habit for today, exactly as ticking the habit does (no tick of its own)", async () => {
    await db.items.put(habit("h-vit", "Vitamins", { doneDates: ["2026-11-16"] }));
    await linkRoutineStep("d4", "h-vit");
    await setRoutineStepDone("d4", TODAY, true);
    expect((await db.items.get("h-vit"))!.doneDates).toEqual(["2026-11-16", TODAY]);
    expect(await db.prefs.get(tickRowId(TODAY, "d4"))).toBeUndefined();
    // Ticking again changes nothing (no double count).
    await setRoutineStepDone("d4", TODAY, true);
    expect((await db.items.get("h-vit"))!.doneDates).toEqual(["2026-11-16", TODAY]);
    await setRoutineStepDone("d4", TODAY, false);
    expect((await db.items.get("h-vit"))!.doneDates).toEqual(["2026-11-16"]);
  });

  it("ticking the habit elsewhere shows the linked step ticked", async () => {
    await db.items.put(habit("h-vit", "Vitamins"));
    await linkRoutineStep("d4", "h-vit");
    await tickItem("h-vit", TODAY);
    const day = await view();
    expect(day.rows.find((r) => r.step.id === "d4")!.done).toBe(true);
  });
});

describe("habit links", () => {
  it("suggested links are stored once, by keyword, and never create a habit", async () => {
    await db.items.bulkPut([habit("h-vit", "Vitamins"), habit("h-up", "Up by 8am + light"), habit("h-wind", "Wind down")]);
    expect(await applySuggestedLinks()).toBe(3);
    const steps = routineSteps((await readRoutine(TODAY)).steps);
    expect(Object.fromEntries(steps.filter((s) => s.habitId).map((s) => [s.id, s.habitId]))).toEqual({ d1: "h-up", d4: "h-vit", d9: "h-wind" });
    expect(await db.items.count()).toBe(3);
    // A default step's row holds only the link (its words still follow the defaults).
    expect(await db.prefs.get(stepRowId("d4"))).toEqual({ id: stepRowId("d4"), habitId: "h-vit", updatedAt: expect.any(Number) });
    expect(await applySuggestedLinks()).toBe(0);
  });

  it("an unlinked step is never suggested again", async () => {
    await db.items.put(habit("h-vit", "Vitamins"));
    await applySuggestedLinks();
    await linkRoutineStep("d4", null);
    expect(await applySuggestedLinks()).toBe(0);
    expect(routineSteps((await readRoutine(TODAY)).steps).find((s) => s.id === "d4")!.habitId).toBeNull();
  });

  it("linking a habit another step has moves it (one step per habit)", async () => {
    await db.items.put(habit("h-vit", "Vitamins"));
    await linkRoutineStep("d4", "h-vit");
    await linkRoutineStep("d5", "h-vit");
    const steps = routineSteps((await readRoutine(TODAY)).steps);
    expect(steps.find((s) => s.id === "d5")!.habitId).toBe("h-vit");
    expect(steps.find((s) => s.id === "d4")!.habitId).toBeNull();
  });
});

describe("editing the routine", () => {
  it("renames and edits the minimum; a blank title is refused", async () => {
    await updateRoutineStep("d2", { title: "  Sit quietly (pretend)  ", min: "one breath" });
    let s = routineSteps((await readRoutine(TODAY)).steps).find((x) => x.id === "d2")!;
    expect(s).toMatchObject({ title: "Sit quietly (pretend)", min: "one breath" });
    await expect(updateRoutineStep("d2", { title: "   " })).rejects.toThrow();
    s = routineSteps((await readRoutine(TODAY)).steps).find((x) => x.id === "d2")!;
    expect(s.title).toBe("Sit quietly (pretend)");
  });

  it("adds a step at the end and removes one (kept as removed, never deleted)", async () => {
    const id = await addRoutineStep("Stretch (pretend)", "one stretch");
    let steps = routineSteps((await readRoutine(TODAY)).steps);
    expect(steps.at(-1)).toMatchObject({ id, title: "Stretch (pretend)", min: "one stretch" });
    await removeRoutineStep("d3");
    steps = routineSteps((await readRoutine(TODAY)).steps);
    expect(steps.map((s) => s.id)).not.toContain("d3");
    expect(await db.prefs.get(stepRowId("d3"))).toMatchObject({ removed: true });
    expect(steps).toHaveLength(10);
  });

  it("moves a step up and down, touching only the two steps that swap", async () => {
    await moveRoutineStep("d3", -1);
    let ids = routineSteps((await readRoutine(TODAY)).steps).map((s) => s.id);
    expect(ids.slice(0, 4)).toEqual(["d1", "d3", "d2", "d4"]);
    expect((await db.prefs.toArray()).map((r) => r.id).sort()).toEqual([stepRowId("d2"), stepRowId("d3")]);
    await moveRoutineStep("d1", 1);
    ids = routineSteps((await readRoutine(TODAY)).steps).map((s) => s.id);
    expect(ids.slice(0, 3)).toEqual(["d3", "d1", "d2"]);
    await moveRoutineStep("d3", -1); // already first: nothing changes
    expect(routineSteps((await readRoutine(TODAY)).steps).map((s) => s.id)[0]).toBe("d3");
  });

  it("an edit merges into the newest row: a link made elsewhere is kept when she renames", async () => {
    await linkRoutineStep("d4", "h-vit");
    await updateRoutineStep("d4", { title: "Vitamins (pretend)" });
    expect(await db.prefs.get(stepRowId("d4"))).toMatchObject({ habitId: "h-vit", title: "Vitamins (pretend)" });
  });
});
