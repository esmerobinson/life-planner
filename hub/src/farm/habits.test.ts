import { addDays, weekdayOf } from "../domain/dates";
import type { ISODate, Item, Weekday } from "../domain/types";
import { STICKERS, STICKER_BY_KEY, SEASONS_KEPT_SET } from "./catalogue";
import { counters, derivedEarned, type EarningInput } from "./earning";

// Habit stickers (review I4 and Esme's decision, 2026-11-04): a month counts at 80% of its planned
// sessions in any order; "Full month" is the first time a habit does every planned session of a
// month; runs of 80% months earn 2, 3, 6 and 12 once each, and a lower month quietly restarts
// the run (nothing earned is ever taken back). Archived things still count (review I3).

const START = "2026-01-01";
let n = 0;
const task = (p: Partial<Item> = {}): Item => ({
  id: `h${++n}`, kind: "task", title: `Pretend ${n}`, links: [], areaId: "body", priority: 2, status: "open",
  createdAt: "2025-12-01", touchedAt: "2025-12-01", ...p,
});
const input = (p: Partial<EarningInput> = {}): EarningInput => ({
  start: START, today: "2026-12-31", items: [], goals: [], todayDone: [], journal: null, ...p,
});
const count = (p: Partial<EarningInput>, source: string) => counters(input(p)).get(source as never);

/** Every Monday of a month ("YYYY-MM"). */
function mondays(month: string): ISODate[] {
  const out: ISODate[] = [];
  for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) if (weekdayOf(d) === "mon") out.push(d);
  return out;
}
/** A Mondays habit ticked on `share` of each listed month's Mondays (rounded up), in any order. */
function mondayHabit(months: Record<string, number>, p: Partial<Item> = {}): Item {
  const ticks: ISODate[] = [];
  for (const [month, share] of Object.entries(months)) {
    const all = mondays(month);
    // From the end of the month backwards: "in any order".
    ticks.push(...all.slice(all.length - Math.ceil(all.length * share)));
  }
  return task({ recur: ["mon" as Weekday], doneDates: ticks.sort(), ...p });
}

describe("the five Seasons kept stickers", () => {
  it("are the Meadow's third set, Seasons kept, after Hedge flowers", () => {
    const mine = STICKERS.filter((s) => s.set === SEASONS_KEPT_SET);
    expect(mine.map((s) => [s.key, s.rule.source, s.rule.at])).toEqual([
      ["full-month", "habit-full-month", 1],
      ["oak-2", "habit-run", 2], ["oak-3", "habit-run", 3],
      ["oak-6", "habit-run", 6], ["oak-12", "habit-run", 12],
    ]);
    expect(mine.every((s) => s.group === "meadow")).toBe(true);
    const keys = STICKERS.map((s) => s.key);
    expect(keys.indexOf("full-month")).toBe(keys.indexOf("bluebell") + 1);
  });
});

describe("habit months at 80%", () => {
  // January 2026 has 4 Mondays (5, 12, 19, 26); March has 5 (2, 9, 16, 23, 30).
  it.each([
    [{ "2026-03": 1 }, 1],
    [{ "2026-03": 0.8 }, 1], // 4 of 5
    [{ "2026-03": 0.6 }, 0], // 3 of 5
    [{ "2026-01": 0.75 }, 0], // 3 of 4 is under 80%
    [{ "2026-01": 1, "2026-03": 0.8, "2026-05": 1 }, 3],
  ])("%o -> %i months", (months, good) => {
    expect(count({ items: [mondayHabit(months)] }, "habit-months")).toBe(good);
  });

  it("Barn things: 1, 3, 6, 12 such months (totals, any months)", () => {
    const h = mondayHabit({ "2026-01": 1, "2026-03": 1, "2026-06": 0.8 });
    const earned = derivedEarned(counters(input({ items: [h] })));
    expect(earned).toEqual(expect.arrayContaining(["haybale", "feed-trough"]));
    expect(earned).not.toContain("weathervane");
  });
});

describe("runs of good months", () => {
  const run = (months: Record<string, number>) => count({ items: [mondayHabit(months)] }, "habit-run");

  it("count calendar months one after another at 80%", () => {
    expect(run({ "2026-01": 1 })).toBe(1);
    expect(run({ "2026-01": 1, "2026-02": 0.8 })).toBe(2);
    expect(run({ "2026-01": 1, "2026-03": 1 })).toBe(1); // February in between had nothing
  });

  it("a lower month quietly restarts the run; what was reached before is kept", () => {
    const months = { "2026-01": 1, "2026-02": 1, "2026-03": 1, "2026-04": 0.5, "2026-05": 1, "2026-06": 1 };
    expect(run(months)).toBe(3);
    const earned = derivedEarned(counters(input({ items: [mondayHabit(months)] })));
    expect(earned).toEqual(expect.arrayContaining(["oak-2", "oak-3"]));
    expect(earned).not.toContain("oak-6");
  });

  it("2, 3, 6 and 12 are each earned once, never again, and there is no one-month sticker", () => {
    const year = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`2026-${String(i + 1).padStart(2, "0")}`, 0.8]));
    const earned = derivedEarned(counters(input({ items: [mondayHabit(year), mondayHabit(year)] })));
    for (const k of ["oak-2", "oak-3", "oak-6", "oak-12"]) {
      expect(earned.filter((x) => x === k)).toHaveLength(1);
    }
    expect(STICKERS.filter((s) => s.rule.source === "habit-run").map((s) => s.rule.at)).toEqual([2, 3, 6, 12]);
  });

  it("runs are per habit: two habits' alternate months don't join up", () => {
    const a = mondayHabit({ "2026-01": 1, "2026-03": 1 });
    const b = mondayHabit({ "2026-02": 1 });
    expect(count({ items: [a, b] }, "habit-run")).toBe(1);
  });

  it("the hints never mention a broken run", () => {
    for (const s of STICKERS.filter((x) => x.set === SEASONS_KEPT_SET || x.set === "Barn things")) {
      expect(s.name.toLowerCase()).not.toMatch(/streak|broke|miss|lost/);
    }
    expect(STICKER_BY_KEY.get("oak-2")).toBeTruthy();
  });
});

describe("nothing is ever taken away by archiving (review I3)", () => {
  it("an archived habit's sessions and an archived done to-do still count; binned ones don't", () => {
    const h = mondayHabit({ "2026-03": 1 }, { status: "archived" });
    const doneThenArchived = task({ areaId: "mind", status: "archived", completedAt: "2026-02-02" });
    const binned = task({ areaId: "mind", status: "deleted", completedAt: "2026-02-03" });
    const c = counters(input({ items: [h, doneThenArchived, binned] }));
    expect(c.get("habit-sessions")).toBe(5);
    expect(c.get("habit-months")).toBe(1);
    expect(c.get("todos:mind")).toBe(1);
  });

  it("reading-list books marked Read since the start (the reading list is built now)", () => {
    const book = (finishedOn: ISODate | undefined, status: "read" | "reading" = "read") =>
      task({ kind: "idea", areaId: "mind", bookStatus: status, finishedOn });
    const c = counters(input({ items: [book("2026-02-01"), book("2025-12-20"), book(undefined, "reading")] }));
    expect(c.get("reading-books")).toBe(1);
    expect(derivedEarned(c)).toContain("pressed-daisy");
  });
});
