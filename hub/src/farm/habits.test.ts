import { addDays, weekdayOf } from "../domain/dates";
import type { ISODate, Item, Weekday } from "../domain/types";
import { STICKERS, STICKER_BY_KEY, SEASONS_KEPT_SET } from "./catalogue";
import { counters, derivedEarned, type EarningInput } from "./earning";

// Habit stickers (review I4 and Esme's decision, 2026-11-04): a month counts at 80% of its planned
// sessions in any order; "Full month" is the first time a habit does every planned session of a
// month; runs of 80% months earn 2, 3 and 6 once each, and a lower month quietly restarts
// the run (nothing earned is ever taken back). The Great oak is 9 good months in any 12 in a row
// (Esme, 2026-11-06). Archived things still count (review I3).

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
      ["oak-6", "habit-run", 6], ["oak-12", "habit-year", 1],
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

  it("Barn things: 1, 2, 3, 5, 8, 12 such months (totals, any months)", () => {
    const h = mondayHabit({ "2026-01": 1, "2026-03": 1, "2026-06": 0.8 });
    const earned = derivedEarned(counters(input({ items: [h] })));
    expect(earned).toEqual(expect.arrayContaining(["haybale", "feed-trough", "weathervane"]));
    expect(earned).not.toContain("barn-lantern");
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

  it("2, 3 and 6 in a row and the Great oak are each earned once, never again, and there is no one-month sticker", () => {
    const year = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`2026-${String(i + 1).padStart(2, "0")}`, 0.8]));
    const earned = derivedEarned(counters(input({ items: [mondayHabit(year), mondayHabit(year)] })));
    for (const k of ["oak-2", "oak-3", "oak-6", "oak-12"]) {
      expect(earned.filter((x) => x === k)).toHaveLength(1);
    }
    expect(STICKERS.filter((s) => s.rule.source === "habit-run").map((s) => s.rule.at)).toEqual([2, 3, 6]);
  });
});

describe("the Great oak: 9 good months within 12 in a row (Esme, 2026-11-06)", () => {
  /** Twelve months of 2026: "g" good (every Monday), "-" nothing. */
  const months = (pattern: string) =>
    Object.fromEntries([...pattern].map((c, i) => [`2026-${String(i + 1).padStart(2, "0")}`, c === "g" ? 1 : 0]));
  const oak = (pattern: string, today = "2026-12-31") =>
    derivedEarned(counters(input({ today, items: [mondayHabit(months(pattern))] }))).includes("oak-12");

  it("is the Great oak's rule", () => {
    expect(STICKER_BY_KEY.get("oak-12")!.rule).toEqual({ source: "habit-year", at: 1 });
  });

  it("one or two off months don't reset it", () => {
    expect(oak("gggggggg-ggg")).toBe(true); // 8 good, 1 off, 3 good
    expect(oak("gg-gggg-ggg-")).toBe(true); // 9 good with two gaps
  });

  it("8 good months in 12 isn't enough", () => {
    expect(oak("gggg--gggg--")).toBe(false);
  });

  it("9 good months in a row count as soon as the ninth is done", () => {
    expect(oak("ggggggggg", "2026-10-01")).toBe(true);
  });

  it("needs one habit: two habits' months don't add up", () => {
    const a = mondayHabit(months("gggg--------"));
    const b = mondayHabit(months("----ggggg---"));
    expect(derivedEarned(counters(input({ items: [a, b] })))).not.toContain("oak-12");
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

describe("a habit's month counts from when it was made, up to when it was archived (Esme, 2026-11-04)", () => {
  // March 2026's Mondays: 2, 9, 16, 23, 30.
  it("a habit made mid-month is judged only on the Mondays since it was made", () => {
    const h = task({ recur: ["mon"], createdAt: "2026-03-16", doneDates: ["2026-03-16", "2026-03-23", "2026-03-30"] });
    expect(count({ items: [h] }, "habit-months")).toBe(1); // 3 of 3, not 3 of 5
    expect(count({ items: [h] }, "habit-full-month")).toBe(1);
  });

  it("80% of the sessions since it was made, any order", () => {
    // Made Tuesday 3 March: 4 Mondays left (9, 16, 23, 30); 3 of 4 is under 80%, 4 of 4 is a month.
    const made = (doneDates: ISODate[]) => task({ recur: ["mon"], createdAt: "2026-03-03", doneDates });
    expect(count({ items: [made(["2026-03-09", "2026-03-23", "2026-03-30"])] }, "habit-months")).toBe(0);
    expect(count({ items: [made(["2026-03-09", "2026-03-16", "2026-03-23", "2026-03-30"])] }, "habit-months")).toBe(1);
  });

  it("an archived habit is judged up to the day it was archived (its last change: archiving sets it)", () => {
    const h = task({ recur: ["mon"], status: "archived", touchedAt: "2026-03-17", doneDates: ["2026-03-02", "2026-03-09", "2026-03-16"] });
    expect(count({ items: [h] }, "habit-months")).toBe(1); // 3 of 3 by the 17th, not 3 of 5
    // Its later months ask nothing of it.
    expect(count({ items: [h], today: "2026-06-30" }, "habit-months")).toBe(1);
  });

  it("an archived habit's end is never before its last tick", () => {
    const h = task({ recur: ["mon"], status: "archived", touchedAt: "2026-03-01", doneDates: ["2026-03-02", "2026-03-09"] });
    expect(count({ items: [h] }, "habit-months")).toBe(1); // up to the 9th: 2 of 2
  });

  it("the farm's start still counts first: nothing before it", () => {
    const h = task({ recur: ["mon"], createdAt: "2025-12-01", doneDates: ["2026-03-16", "2026-03-23", "2026-03-30"] });
    expect(count({ items: [h], start: "2026-03-10" }, "habit-months")).toBe(1); // 3 of 3 since the start
    expect(count({ items: [h], start: "2026-03-01" }, "habit-months")).toBe(0); // 3 of 5
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
